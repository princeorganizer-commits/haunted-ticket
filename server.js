const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer();

const EASYSLIP_API_KEY = process.env.EASYSLIP_API_KEY || "e5d92f80-924d-44a0-965a-9e98b6a17457";
const DB_FILE = path.join(__dirname, 'bookings.json');

// อ่านข้อมูลการจองจากไฟล์
function getBookings() {
    if (!fs.existsSync(DB_FILE)) {
        return {};
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// บันทึกข้อมูลการจองลงไฟล์
function saveBookings(bookings) {
    fs.writeFileSync(DB_FILE, JSON.stringify(bookings, null, 2));
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API ดึงจำนวนคนจองในแต่ละวันและรอบ
app.get('/api/booked-slots', (req, res) => {
    const { date } = req.query;
    const bookings = getBookings();
    const dayBookings = bookings[date] || {};
    res.json({ success: true, slots: dayBookings });
});

// API ตรวจสอบสลิปและบันทึกการจอง
app.post('/api/verify-slip', upload.single('slip'), async (req, res) => {
    try {
        const { name, date, slot, quantity } = req.body;
        const qty = parseInt(quantity) || 1;

        if (!req.file) {
            return res.json({ success: false, message: 'กรุณาแนบรูปภาพสลิปโอนเงิน' });
        }

        // เช็กจำนวนคนในรอบก่อนตรวจสลิป
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

        // ส่งตรวจสลิปกับ Easy Slip
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
        });

        const response = await axios.post('https://developer.easyslip.com/api/v1/verify', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${EASYSLIP_API_KEY}`
            }
        });

        const result = response.data;

        if (result.status === 200) {
            // สลิปผ่าน -> บันทึกจำนวนคนเพิ่มในระบบ
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
                message: result.message || 'สลิปไม่ถูกต้อง หรือเคยถูกใช้งานไปแล้ว' 
            });
        }

    } catch (error) {
        console.error('EasySlip Error:', error.response ? error.response.data : error.message);
        return res.json({ 
            success: false, 
            message: 'ไม่สามารถตรวจสอบสลิปได้ กรุณาตรวจสอบรูปภาพสลิปแล้วลองใหม่อีกครั้ง' 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
