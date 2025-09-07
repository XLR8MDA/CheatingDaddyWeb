const express = require('express');
const Groq = require('groq-sdk');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config();

const app = express();
const port = 3000;

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const upload = multer({ dest: os.tmpdir() });

app.use(express.static('public'));
app.use(express.json());

app.post('/stt', (req, res) => {
    console.log('--- /stt endpoint hit ---');
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    res.status(200).json({ text: 'This is a test response from /stt' });
});

app.post('/groq', async (req, res) => {
    const { history, prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    const messages = [
        ...history.map(msg => ({ role: msg.role, content: msg.content })),
        {
            role: 'user',
            content: prompt
        }
    ];

    try {
        const stream = await groq.chat.completions.create({
            messages: messages,
            model: 'llama-3.1-8b-instant',
            stream: true
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of stream) {
            if (chunk.choices[0].delta.content) {
                res.write(`data: ${JSON.stringify(chunk.choices[0].delta)}\n\n`);
            }
        }

        res.end();
    } catch (error) {
        console.error('Groq API Error:', error);
        // Ensure no more writes happen after an error
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get response from Groq API.' });
        } else {
            res.end();
        }
    }
});

// Start the server only if the script is run directly
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
    });
}

module.exports = app;