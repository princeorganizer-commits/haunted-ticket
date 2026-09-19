const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();

const upload = multer({
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('กรุณาอัปโหลดไฟล์รูปภาพเท่านั้น'));
        }
    }
});

const TICKET_PRICE_PER_PERSON = 120;
const EASYSLIP_API_KEY = process.env.EASYSLIP_API_KEY || "e5d92f80-924d-44a0-965a-9e98b6a17457";

// กำหนดค่าอ้างอิงร้านค้าแบบครอบคลุม
const TARGET_RECEIVER_NAMES = ["กฤตธีญาภา", "ปรินทษ์"];
const TARGET_SHOP_CODES = ["014000000579698", "010753600010286"];

const DB_FILE = path.join(__dirname, 'bookings.json');
const USED_SLIPS_FILE = path.join(__dirname, 'used_slips.json');

function getBookings() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        return {};
    }
}

function saveBookings(bookings) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(bookings, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving bookings.json:', e);
    }
}

function getUsedSlips() {
    if (!fs.existsSync(USED_SLIPS_FILE)) return [];
    try {
        const data = fs.readFileSync(USED_SLIPS_FILE, 'utf8');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveUsedSlip(slipRef) {
    if (!slipRef) return;
    const usedSlips = getUsedSlips();
    const cleanRef = String(slipRef).trim();
    if (!usedSlips.includes(cleanRef)) {
        usedSlips.push(cleanRef);
        try {
            fs.writeFileSync(USED_SLIPS_FILE, JSON.stringify(usedSlips, null, 2), 'utf8');
        } catch (e) {
            console.error('Error saving used_slips.json:', e);
        }
    }
}

app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/booked-slots', (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: 'กรุณาระบุวันที่' });
        const bookings = getBookings();
        res.json({ success: true, slots: bookings[date] || {} });
    } catch (err) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
});

app.post('/api/verify-slip', (req, res, next) => {
    upload.single('slip')(req, res, (err) => {
        if (err) return res.json({ success: false, message: err.message || 'ไฟล์รูปภาพไม่ถูกต้อง' });
        next();
    });
}, async (req, res) => {
    try {
        const { name, date, slot, quantity } = req.body;
        const qty = parseInt(quantity, 10) || 1;

        if (!req.file) return res.json({ success: false, message: 'กรุณาแนบรูปภาพสลิปโอนเงิน' });

        const bookings = getBookings();
        if (!bookings[date]) bookings[date] = {};
        const currentQty = bookings[date][slot] || 0;

        if (currentQty + qty > 10) {
            const available = 10 - currentQty;
            return res.json({ 
                success: false, 
                message: available > 0 
                    ? `รอบเวลานี้เหลือว่างอีกเพียง ${available} ที่นั่ง` 
                    : `ขออภัย รอบเวลา ${slot} มีผู้จองเต็มแล้ว` 
            });
        }

        const expectedAmount = TICKET_PRICE_PER_PERSON * qty;
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname || 'slip.jpg',
            contentType: req.file.mimetype || 'image/jpeg',
        });

        const response = await axios.post('https://developer.easyslip.com/api/v1/verify', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${EASYSLIP_API_KEY.trim()}`
            },
            timeout: 15000
        });

        const result = response.data;

        if (result && result.status === 200) {
            const slipData = result.data || {};
            
            // ==========================================
            // ด่านที่ 1: ตรวจสอบสลิปซ้ำก่อนเป็นอันดับแรก
            // ==========================================
            const slipRef = slipData.transRef || slipData.payload || slipData.ref1 || slipData.transId;
            if (slipRef) {
                const usedSlips = getUsedSlips();
                if (usedSlips.includes(String(slipRef).trim())) {
                    return res.json({
                        success: false,
                        message: 'สลิปนี้ถูกใช้งานไปแล้ว ไม่สามารถนำมาใช้ซ้ำได้'
                    });
                }
            } else {
                return res.json({
                    success: false,
                    message: 'ไม่สามารถระบุเลขที่รายการในสลิปได้ กรุณาใช้สลิปอื่น'
                });
            }

            // ==========================================
            // ด่านที่ 2: ตรวจสอบ "ผู้รับเงิน" (Receiver Strict Check)
            // ==========================================
            const receiverObj = slipData.receiver || slipData.to || {};
            const receiverStr = JSON.stringify(receiverObj);
            const fullSlipStr = JSON.stringify(slipData);

            // เช็กว่ามีชื่อผู้รับตรง หรือ มีรหัส Biller/Merchant ตรงในสลิป
            const isNameMatched = TARGET_RECEIVER_NAMES.some(name => receiverStr.includes(name));
            const isCodeMatched = TARGET_SHOP_CODES.some(code => fullSlipStr.includes(code));

            if (!isNameMatched && !isCodeMatched) {
                return res.json({
                    success: false,
                    message: 'สลิปนี้ไม่ได้โอนเข้าบัญชีร้านค้าของทางงาน กรุณาตรวจสอบสลิปอีกครั้ง'
                });
            }

            // ==========================================
            // ด่านที่ 3: ตรวจสอบยอดเงิน (Amount Check)
            // ==========================================
            let paidAmount = 0;

            if (typeof slipData.amount === 'number') {
                paidAmount = slipData.amount;
            } else if (slipData.amount && typeof slipData.amount.value === 'number') {
                paidAmount = slipData.amount.value;
            } else if (slipData.amount && typeof slipData.amount.amount === 'number') {
                paidAmount = slipData.amount.amount;
            } else if (typeof slipData.transAmount === 'number') {
                paidAmount = slipData.transAmount;
            }

            if (paidAmount <= 0 || paidAmount < expectedAmount) {
                return res.json({
                    success: false,
                    message: `ยอดเงินในสลิป (${paidAmount} บาท) ไม่ถูกต้องหรือน้อยกว่ายอดที่ต้องชำระ (${expectedAmount} บาท)`
                });
            }

            // ==========================================
            // ผ่านทุกด่าน -> บันทึกข้อมูลและออกตั๋ว
            // ==========================================
            saveUsedSlip(slipRef);
            bookings[date][slot] = currentQty + qty;
            saveBookings(bookings);

            const ticketId = 'HEIAN-' + Math.floor(100000 + Math.random() * 900000);
            return res.json({
                success: true,
                ticketId: ticketId,
                data: slipData
            });

        } else {
            return res.json({ 
                success: false, 
                message: result.message || 'สลิปไม่ถูกต้อง หรือไม่พบข้อมูลการโอนเงิน' 
            });
        }

    } catch (error) {
        console.error('Verify Slip Error:', error.response ? error.response.data : error.message);
        const apiErrorMsg = error.response && error.response.data && error.response.data.message 
            ? error.response.data.message 
            : 'รูปภาพสลิปไม่ชัดเจน หรือไม่สามารถอ่าน QR Code ในสลิปได้';

        return res.json({ 
            success: false, 
            message: `ตรวจสอบไม่สำเร็จ: ${apiErrorMsg}` 
        });
    }
});

app.use((req, res) => {
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
