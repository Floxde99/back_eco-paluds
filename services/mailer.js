require('dotenv').config();
const nodemailer = require('nodemailer');

const port = parseInt(process.env.MAIL_PORT || '0', 10) || undefined;
const secure = port === 465; // port 465 => secure true (SMTPS)

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port,
  secure,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// Verify transporter at startup
transporter.verify().then(() => {
  console.log('✅ Mailer transporter ready');
}).catch(err => {
  console.warn('⚠️ Mailer transporter verification failed:', err.message || err);
});

function sendMail(to, subject, text, html) {
  const mailOptions = {
    from: `"Eco-Paluds" <${process.env.MAIL_USER}>`,
    to,
    subject,
    text,
    html,
  };

  return transporter.sendMail(mailOptions).then(info => {
    console.log('✅ Email envoyé :', info && info.response);
    return info;
  }).catch(error => {
    console.error('❌ Erreur envoi email :', error);
    throw error;
  });
}

module.exports = { sendMail };
