require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: parseInt(process.env.MAIL_PORT),
  secure: true, // SSL
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

function sendMail(to, subject, text, html) {
  const mailOptions = {
    from: `"Eco-Paluds" <${process.env.MAIL_USER}>`,
    to,
    subject,
    text,
    html
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('❌ Erreur envoi email :', error);
    } else {
      console.log('✅ Email envoyé :', info.response);
    }
  });
}

module.exports = { sendMail };
