const startBtn = document.getElementById('start-btn');
const conversation = document.getElementById('conversation');
const outputToggle = document.getElementById('output-toggle');
let conversationHistory = [];
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// Event listener for the start/stop button
startBtn.addEventListener('click', () => {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
});

/**
 * Starts the audio recording process.
 */
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            audioChunks = [];
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');

            try {
                const sttResponse = await fetch('/stt', {
                    method: 'POST',
                    body: formData
                });

                if (!sttResponse.ok) {
                    const errorData = await sttResponse.json();
                    throw new Error(errorData.error || 'Failed to transcribe audio.');
                }

                const data = await sttResponse.json();
                addMessage('user', data.text);
                getGroqResponse(data.text);

            } catch (error) {
                console.error('STT Error:', error);
                addMessage('assistant', `Sorry, I had trouble transcribing that. (${error.message})`);
            }
        };

        mediaRecorder.start();
        startBtn.textContent = 'Stop Listening';
        isRecording = true;

    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Error accessing microphone. Please ensure you have given permission.');
    }
}

/**
 * Stops the audio recording.
 */
function stopRecording() {
    if (mediaRecorder) {
        mediaRecorder.stop();
        startBtn.textContent = 'Listen';
        isRecording = false;
    }
}

/**
 * Adds a message to the conversation history and re-renders the display.
 */
function addMessage(role, content, isStreaming = false) {
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.role === role && lastMessage.isStreaming) {
        lastMessage.content += content;
    } else {
        conversationHistory.push({ role, content, isStreaming });
    }

    renderConversation();
}

/**
 * Updates the streaming status of the last assistant message.
 */
function setAssistantStreaming(isStreaming) {
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.isStreaming = isStreaming;
    }
}

/**
 * Renders the entire conversation history to the screen.
 */
function renderConversation() {
    conversation.innerHTML = '';
    conversationHistory.forEach(message => {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');

        const roleEl = document.createElement('strong');
        roleEl.textContent = message.role === 'user' ? 'You: ' : 'Assistant: ';
        messageEl.appendChild(roleEl);

        const contentEl = document.createElement('div');
        contentEl.classList.add('content');
        
        if (message.role === 'assistant') {
            contentEl.innerHTML = marked.parse(message.content);
        } else {
            contentEl.textContent = message.content;
        }
        messageEl.appendChild(contentEl);
        conversation.appendChild(messageEl);
    });

    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    
    conversation.scrollTop = conversation.scrollHeight;
}

/**
 * Sends the user's prompt to the server and handles the streaming response.
 */
async function getGroqResponse(prompt) {
    addMessage('assistant', '', true);

    // *** NEW LOGIC HERE ***
    // 1. Get the state of the toggle switch.
    const isConcise = outputToggle.checked;
    // 2. Get the last 5 messages for context.
    const relevantHistory = conversationHistory.slice(0, -2);
    const shortHistory = relevantHistory.slice(-6);

    try {
        const response = await fetch('/groq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 3. Send the history, prompt, and new outputStyle to the server.
            body: JSON.stringify({ 
                history: shortHistory, 
                prompt, 
                outputStyle: isConcise ? 'short' : 'long' 
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get response from server.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                setAssistantStreaming(false);
                break;
            }
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.substring(6));
                    if (data.content) {
                        addMessage('assistant', data.content, true);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Groq Error:', error);
        const lastMessage = conversationHistory[conversationHistory.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = 'Sorry, I had trouble getting a response.';
            lastMessage.isStreaming = false;
            renderConversation();
        }
    }
}