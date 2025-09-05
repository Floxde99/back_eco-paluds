require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const app = express();
const userRouter = require('./routers/userRouter');
const contactRouter = require('./routers/contactRouter');
require('fs');

app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://localhost:5174',
        'http://127.0.0.1:3000',
        'http://localhost:3000'
    ], 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/', userRouter);

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