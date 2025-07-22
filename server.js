const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const userRouter = require('./routers/userRouter');

app.use(cors({
    origin: 'http://127.0.0.1:3000', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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