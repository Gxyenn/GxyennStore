const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.MAILTRAP_HOST,
    port: parseInt(process.env.MAILTRAP_PORT || "2525"),
    auth: {
        user: process.env.MAILTRAP_USER,
        pass: process.env.MAILTRAP_PASS
    }
});

const sendEmail = async (to, subject, htmlContent, textContent) => {
    const mailOptions = {
        from: `"Gxyenn Store" <${process.env.FROM_EMAIL}>`,
        to: to,
        subject: subject,
        text: textContent || htmlContent.replace(/<[^>]*>?/gm, ''), // Simple text version
        html: htmlContent,
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log('Message sent: %s', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

module.exports = { sendEmail };