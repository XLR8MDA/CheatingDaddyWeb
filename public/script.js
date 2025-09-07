const startBtn = document.getElementById('start-btn');
const conversation = document.getElementById('conversation');
let conversationHistory = [];
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

startBtn.addEventListener('click', () => {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
});

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
            formData.append('audio', audioBlob);

            try {
                const sttResponse = await fetch('/stt', {
                    method: 'POST',
                    body: formData
                });

                if (!sttResponse.ok) {
                    throw new Error('Failed to transcribe audio.');
                }

                const data = await sttResponse.json();
                addMessage('user', data.text);
                getGroqResponse(data.text);

            } catch (error) {
                console.error('STT Error:', error);
                addMessage('assistant', 'Sorry, I had trouble transcribing your speech.');
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

function stopRecording() {
    mediaRecorder.stop();
    startBtn.textContent = 'Listen';
    isRecording = false;
}

function addMessage(role, content, isStreaming = false) {
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.role === role && lastMessage.isStreaming) {
        lastMessage.content += content;
    } else {
        conversationHistory.push({ role, content, isStreaming });
    }

    if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
    }
    renderConversation();
}

function setAssistantStreaming(isStreaming) {
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.isStreaming = isStreaming;
    }
}

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

    // Apply syntax highlighting to all code blocks
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
}

async function getGroqResponse(prompt) {
    addMessage('assistant', '', true); // Start with an empty streaming message

    try {
        const response = await fetch('/groq', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ history: conversationHistory.slice(0, -2), prompt })
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
        console.error('Error:', error);
        const lastMessage = conversationHistory[conversationHistory.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = 'Sorry, I had trouble getting a response.';
            lastMessage.isStreaming = false;
            renderConversation();
        }
    }
}
