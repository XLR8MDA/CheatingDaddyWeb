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

// Configure Multer to save uploaded files to the system's temporary directory
const upload = multer({ dest: os.tmpdir() });

// Serve static files from the 'public' directory
app.use(express.static('public'));

/**
 * Endpoint to handle audio transcription (Speech-to-Text).
 */
app.post('/stt', upload.single('audio'), async (req, res) => {
    console.log('--- /stt endpoint hit ---');

    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    // Robust Solution: Rename the temporary file to include a .webm extension
    const originalPath = req.file.path;
    const newPath = `${originalPath}.webm`;

    try {
        fs.renameSync(originalPath, newPath);
        console.log(`File renamed to: ${newPath}`);

        // Send the RENAMED file to Groq
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(newPath),
            model: 'whisper-large-v3',
        });

        console.log('Transcription successful:', transcription.text);
        res.json({ text: transcription.text });

    } catch (error) {
        console.error('Groq STT Error:', error);
        res.status(500).json({ error: 'Failed to transcribe audio.' });
    } finally {
        // Clean up the renamed file
        fs.unlink(newPath, (err) => {
            if (err && err.code !== 'ENOENT') { // Ignore error if file doesn't exist
                console.error('Failed to delete temp file:', err);
            } else {
                console.log('Temporary file deleted successfully.');
            }
        });
    }
});

/**
 * Endpoint for chat completions, using route-specific JSON parsing.
 */
app.post('/groq', express.json(), async (req, res) => {
    const { history, prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    const messages = [
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
    } catch (error) {
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