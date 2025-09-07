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

// Configure Multer
const upload = multer({ dest: os.tmpdir() });

// Serve static files
app.use(express.static('public'));

/**
 * Endpoint for audio transcription
 */
app.post('/stt', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    const originalPath = req.file.path;
    const newPath = `${originalPath}.webm`;

    try {
        fs.renameSync(originalPath, newPath);
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(newPath),
            model: 'whisper-large-v3',
        });
        res.json({ text: transcription.text });
    } catch (error) {
        console.error('Groq STT Error:', error);
        res.status(500).json({ error: 'Failed to transcribe audio.' });
    } finally {
        fs.unlink(newPath, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.error('Failed to delete temp file:', err);
            }
        });
    }
});

/**
 * Endpoint for chat completions
 */
app.post('/groq', express.json(), async (req, res) => {
    // *** NEW LOGIC HERE ***
    // 1. Receive the outputStyle from the client, defaulting to 'short'.
    const { history, prompt, outputStyle = 'short' } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }
    
    // 2. Define system prompts based on the desired output style.
    let systemMessageContent;
    if (outputStyle === 'short') {
       systemMessageContent = "You are a 'TL;DR' bot specializing in interview responses. Your single most important goal is extreme brevity. Get directly to the point. Omit all conversational fluff, introductions, and summaries or examples. Use a maximum of 3 bullet points with description not more then one line each or a short paragraph.";
    } else { // 'long'
        systemMessageContent = "You are an AI Assistant. Your goal is to provide comprehensive, educational answers. Explain concepts thoroughly. When applicable, structure your response by providing a clear definition, followed by practical examples, and concluding with strategic advice for the interview. Use formatting like **bolding** for key terms to enhance clarity.";
    }

    // 3. Construct the messages array with the new system prompt.
    const messages = [
        {
            role: 'system',
            content: systemMessageContent
        },
        ...history.map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: prompt }
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
            if (chunk.choices[0]?.delta?.content) {
                res.write(`data: ${JSON.stringify(chunk.choices[0].delta)}\n\n`);
            }
        }
        res.end();
    } catch (error)
    {
        console.error('Groq API Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get response from Groq API.' });
        } else {
            res.end();
        }
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});