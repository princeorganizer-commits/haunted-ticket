const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// 🔑 นำ API Key ฟรี 7 วันจาก EasySlip มาใส่ตรงนี้
const EASYSLIP_API_KEY = 'ใส่_API_KEY_ที่ได้จาก_EASYSLIP_ตรงนี้';

// ข้อมูลผู้จัดงานที่ต้องตรวจสอบความถูกต้อง
const TARGET_ACCOUNT_NAME = 'กฤตธีญาภา จารุสันต์'; // หรือชื่อบัญชีภาษาอังกฤษตามสลิป
const TICKET_PRICE = 120;

app.use(express.static(__dirname));
app.use(express.json());

// API Endpoint สำหรับรับสลิปและตรวจสอบกับ EasySlip
app.post('/api/verify-slip', upload.single('slip'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'กรุณาอัปโหลดไฟล์สลิป' });
        }

        const quantity = parseInt(req.body.quantity) || 1;
        const expectedAmount = quantity * TICKET_PRICE;

        // เตรียมไฟล์ส่งไปยัง EasySlip API
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', req.file.buffer, { filename: 'slip.jpg' });

        // ยิงตรวจสอบกับ EasySlip
        const response = await axios.post('https://developer.easyslip.com/api/v1/verify', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${EASYSLIP_API_KEY}`
            }
        });

        const slipData = response.data.data;

        // 1. ตรวจสอบชื่อผู้รับเงิน
        const receiverName = slipData.receiver.account.name.th || slipData.receiver.account.name.en;
        if (!receiverName.includes('กฤตธีญาภา')) {
            return res.json({ 
                success: false, 
                message: '❌ บัญชีผู้รับเงินไม่ถูกต้อง ต้องโอนเข้าบัญชี กฤตธีญาภา จารุสันต์ เท่านั้น' 
            });
        }

        // 2. ตรวจสอบยอดเงินโอน
        if (slipData.amount.value < expectedAmount) {
            return res.json({ 
                success: false, 
                message: `❌ ยอดเงินไม่ถูกต้อง (โอนมา ${slipData.amount.value} บาท แต่ต้องชำระ ${expectedAmount} บาท)` 
            });
        }

        // หากผ่านทุกเงื่อนไข ออกตั๋วสำเร็จ
        return res.json({
            success: true,
            message: '✅ ตรวจสอบสลิปถูกต้องสำเร็จ',
            transRef: slipData.transRef
        });

    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        return res.status(500).json({ 
            success: false, 
            message: '❌ ไม่สามารถอ่าน QR Code บนสลิปได้ หรือสลิปไม่ถูกต้อง' 
        });
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
