const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();

// ตั้งค่า Upload จำกัดขนาดไฟล์สลิปไม่เกิน 10MB และรับเฉพาะไฟล์รูปภาพ
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

const DB_FILE = path.join(__dirname, 'bookings.json');
const USED_SLIPS_FILE = path.join(__dirname, 'used_slips.json');

// --- Helper Functions สำหรับจัดการไฟล์ข้อมูลอย่างปลอดภัย ---
function getBookings() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error('Error reading bookings.json:', e);
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
        console.error('Error reading used_slips.json:', e);
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

// Middelwares
app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API ดึงจำนวนคนจองในแต่ละวันและรอบ
app.get('/api/booked-slots', (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'กรุณาระบุวันที่' });
        }
        const bookings = getBookings();
        const dayBookings = bookings[date] || {};
        res.json({ success: true, slots: dayBookings });
    } catch (err) {
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลรอบเวลา' });
    }
});

// API ตรวจสอบสลิปและออกตั๋ว Real-Time
app.post('/api/verify-slip', (req, res, next) => {
    upload.single('slip')(req, res, (err) => {
        if (err) {
            return res.json({ success: false, message: err.message || 'ไฟล์รูปภาพไม่ถูกต้อง หรือขนาดใหญ่เกินไป' });
        }
        next();
    });
}, async (req, res) => {
    try {
        const { name, date, slot, quantity } = req.body;
        const qty = parseInt(quantity, 10) || 1;

        // 1. Validation เบื้องต้น
        if (!req.file) {
            return res.json({ success: false, message: 'กรุณาแนบรูปภาพสลิปโอนเงิน' });
        }
        if (!date || !slot) {
            return res.json({ success: false, message: 'ข้อมูลวันที่หรือรอบเวลาไม่สมบูรณ์' });
        }

        // 2. ตรวจสอบโควต้าที่นั่งว่าง (จำกัด 10 คน/รอบ)
        const bookings = getBookings();
        if (!bookings[date]) bookings[date] = {};
        const currentQty = bookings[date][slot] || 0;

        if (currentQty + qty > 10) {
            const available = 10 - currentQty;
            return res.json({ 
                success: false, 
                message: available > 0 
                    ? `รอบเวลานี้เหลือว่างอีกเพียง ${available} ที่นั่ง ไม่พอสำหรับ ${qty} ท่าน` 
                    : `ขออภัย รอบเวลา ${slot} ประจำวันที่ ${date} มีผู้จองเต็ม 10 ท่านแล้ว` 
            });
        }

        // 3. เตรียมข้อมูลส่งไป EasySlip API
        const expectedAmount = TICKET_PRICE_PER_PERSON * qty;
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname || 'slip.jpg',
            contentType: req.file.mimetype || 'image/jpeg',
        });
        formData.append('amount', expectedAmount.toString());

        // 4. ส่งตรวจสอบกับ EasySlip API
        const response = await axios.post('https://developer.easyslip.com/api/v1/verify', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${EASYSLIP_API_KEY.trim()}`
            },
            timeout: 15000 // กำหนด Timeout 15 วินาที
        });

        const result = response.data;

        if (result && result.status === 200) {
            const slipData = result.data || {};
            // ดึงรหัสอ้างอิงของสลิปเพื่อป้องกันการใช้ซ้ำ
            const slipRef = slipData.transRef || slipData.payload || slipData.ref1 || (slipData.sender ? slipData.transDate : null);

            if (slipRef) {
                const usedSlips = getUsedSlips();
                if (usedSlips.includes(String(slipRef).trim())) {
                    return res.json({
                        success: false,
                        message: 'สลิปนี้ถูกใช้งานไปแล้วในระบบ ไม่สามารถนำมาใช้ซ้ำได้'
                    });
                }
            }

            // บันทึกรหัสสลิปว่าถูกใช้งานแล้ว
            if (slipRef) {
                saveUsedSlip(slipRef);
            }

            // อัปเดตจำนวนการจองเข้าระบบ
            bookings[date][slot] = currentQty + qty;
            saveBookings(bookings);

            // ออกรหัสตั๋ว
            const ticketId = 'HEIAN-' + Math.floor(100000 + Math.random() * 900000);
            return res.json({
                success: true,
                ticketId: ticketId,
                data: slipData
            });

        } else {
            return res.json({ 
                success: false, 
                message: result.message || 'สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรงกับราคาบัตร' 
            });
        }

    } catch (error) {
        console.error('Verify Slip Error:', error.response ? error.response.data : error.message);

        // จัดการข้อความ Error ให้ผู้ใช้เข้าใจง่าย
        if (error.response && error.response.status === 401) {
            return res.json({ success: false, message: 'ระบบตรวจสอบสลิปขัดข้อง (API Key ไม่ถูกต้อง)' });
        }
        
        const apiErrorMsg = error.response && error.response.data && error.response.data.message 
            ? error.response.data.message 
            : 'รูปภาพสลิปไม่ชัดเจน ไม่พบ QR Code หรือระบบไม่สามารถอ่านข้อมูลสลิปนี้ได้';

        return res.json({ 
            success: false, 
            message: `ตรวจสอบไม่สำเร็จ: ${apiErrorMsg}` 
        });
    }
});

// Fallback ป้องกันการเข้าผิด Route
app.use((req, res) => {
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
