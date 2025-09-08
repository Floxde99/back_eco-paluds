require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const userRouter = require('./routers/userRouter');
const contactRouter = require('./routers/contactRouter');
const dashboardRouter = require('./routers/dashboardRouter');
require('fs');

app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://localhost:5174',
        'http://127.0.0.1:3000',
        'http://localhost:3000',
        'https://eco-paluds.fr',
        'https://www.eco-paluds.fr'
    ], 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques (avatars)
app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));

app.use('/', userRouter);
app.use('/contact', contactRouter); // Ajouter cette ligne
app.use('/dashboard', dashboardRouter);

app.listen(process.env.PORT, (err) => {
    if (err) {
        console.error(err);
        return;
    } else {
        console.log(`connecté sur le port ${process.env.PORT}`);
    }
});

console.log('cwd:', process.cwd());
console.log('ENV check -> MAIL_HOST:', process.env.MAIL_HOST, 'MAIL_PORT:', process.env.MAIL_PORT, 'PORT:', process.env.PORT);
console.log('tokenUtils exists:', require('fs').existsSync(__dirname + '/services/tokenUtils.js'));