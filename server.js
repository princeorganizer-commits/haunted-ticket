const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer();

// กำหนดราคาบัตรต่อ 1 ท่าน (ปรับเปลี่ยนตัวเลขตรงนี้ได้ครับ เช่น 120)
const TICKET_PRICE_PER_PERSON = 120; 

const EASYSLIP_API_KEY = process.env.EASYSLIP_API_KEY || "e5d92f80-924d-44a0-965a-9e98b6a17457";
const DB_FILE = path.join(__dirname, 'bookings.json');

function getBookings() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveBookings(bookings) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(bookings, null, 2));
    } catch (e) {
        console.error('Save booking error:', e);
    }
}

app.use(express.static(__dirname));
app.use(express.json());

// API ดึงจำนวนคนจอง
app.get('/api/booked-slots', (req, res) => {
    const { date } = req.query;
    const bookings = getBookings();
    const dayBookings = bookings[date] || {};
    res.json({ success: true, slots: dayBookings });
});

// API ตรวจสอบสลิปแม่มณี / PromptPay แบบ Real-Time อัตโนมัติ
app.post('/api/verify-slip', upload.single('slip'), async (req, res) => {
    try {
        const { name, date, slot, quantity } = req.body;
        const qty = parseInt(quantity) || 1;

        if (!req.file) {
            return res.json({ success: false, message: 'กรุณาแนบรูปภาพสลิปโอนเงิน' });
        }

        // 1. ตรวจสอบจำนวนที่นั่งว่าง
        const bookings = getBookings();
        if (!bookings[date]) bookings[date] = {};
        const currentQty = bookings[date][slot] || 0;

        if (currentQty + qty > 10) {
            const available = 10 - currentQty;
            return res.json({ 
                success: false, 
                message: available > 0 
                    ? `รอบเวลานี้เหลือว่างอีกเพียง ${available} ที่นั่ง` 
                    : `ขออภัย รอบเวลา ${slot} ประจำวันที่ ${date} มีผู้จองเต็ม 10 ท่านแล้ว` 
            });
        }

        // 2. คำนวณยอดเงินที่ต้องชำระจริง
        const expectedAmount = TICKET_PRICE_PER_PERSON * qty;

        // 3. แนบสลิปและส่งไปตรวจสอบที่ EasySlip API
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });
        // ส่งยอดเงินคาดหวังไปตรวจสอบด้วย
        formData.append('amount', expectedAmount.toString()); 

        const response = await axios.post('https://developer.easyslip.com/api/v1/verify', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${EASYSLIP_API_KEY}`
            }
        });

        const result = response.data;

        // 4. ถ้าสลิปถูกต้องและยอดเงินตรง
        if (result.status === 200) {
            bookings[date][slot] = currentQty + qty;
            saveBookings(bookings);

            const ticketId = 'HEIAN-' + Math.floor(100000 + Math.random() * 900000);
            return res.json({
                success: true,
                ticketId: ticketId,
                data: result.data
            });
        } else {
            return res.json({ 
                success: false, 
                message: result.message || 'สลิปไม่ถูกต้อง ยอดเงินไม่ตรง หรือสลิปนี้ถูกใช้งานไปแล้ว' 
            });
        }

    } catch (error) {
        const errorMsg = error.response && error.response.data && error.response.data.message 
            ? error.response.data.message 
            : 'รูปภาพสลิปไม่ชัดเจน หรือระบบไม่สามารถอ่าน QR Code ในสลิปได้';
            
        console.error('EasySlip Error Details:', error.response ? error.response.data : error.message);
        return res.json({ 
            success: false, 
            message: `ตรวจสอบไม่สำเร็จ: ${errorMsg}` 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
