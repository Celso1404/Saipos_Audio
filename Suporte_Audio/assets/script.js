document.addEventListener("DOMContentLoaded", ( ) => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const sendBtn = document.getElementById('sendBtn');
  const audioPlayer = document.getElementById('audioPlayer');
  const statusDiv = document.getElementById('statusDiv');
  const recordingIndicator = document.querySelector('.recording-indicator');

  let mediaRecorder;
  let audioChunks = [];
  let recordedBlob = null;
  let zafClient = null;
  let ticketId = null;

  const SERVER_URL = 'http://localhost:3000'; // URL do seu backend

  // Função para exibir status
  function showStatus(message, type = 'info' ) {
    statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
  }

  // Inicializar o ZAF Client
  try {
    zafClient = ZAFClient.init();
    zafClient.invoke('resize', { width: '100%', height: '400px' });
    showStatus('Aplicativo inicializado. Buscando dados do ticket...', 'info');
    getTicketId();
  } catch (error) {
    console.error("Erro ao inicializar ZAF:", error);
    showStatus("Falha ao carregar o aplicativo no Zendesk.", "error");
  }

  // Obter o ID do Ticket
  async function getTicketId() {
    try {
      const data = await zafClient.get('ticket.id');
      ticketId = data['ticket.id'];
      if (ticketId) {
        showStatus(`Ticket ID ${ticketId} encontrado. Pronto para gravar.`, 'success');
        startBtn.disabled = false;
      } else {
        throw new Error("ID do ticket não retornado.");
      }
    } catch (error) {
      console.error("Erro ao obter ticket ID:", error);
      showStatus("Não foi possível obter o ID do ticket. O app funciona dentro de um ticket?", "error");
    }
  }

  // Lógica de Gravação
  startBtn.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(recordedBlob);
        audioPlayer.src = audioUrl;
        audioPlayer.style.display = 'block';
        sendBtn.disabled = false;
        showStatus('Gravação concluída. Pronto para enviar.', 'success');
        recordingIndicator.style.display = 'none';
      };

      mediaRecorder.start();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      sendBtn.disabled = true;
      showStatus('Gravando...', 'info');
      recordingIndicator.style.display = 'inline-block';
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      showStatus('Erro ao acessar o microfone. Verifique as permissões.', 'error');
    }
  });

  stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });

  // Lógica de Envio
  sendBtn.addEventListener('click', async () => {
    if (!recordedBlob || !ticketId) {
      showStatus('Faltam dados para o envio (áudio ou ID do ticket).', 'error');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.classList.add('loading');
    showStatus('Enviando áudio...', 'info');

    const formData = new FormData();
    formData.append('audio', recordedBlob, 'gravacao.webm');
    formData.append('ticketId', ticketId);

    try {
      const response = await fetch(`${SERVER_URL}/upload-and-send`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        showStatus('Áudio enviado com sucesso!', 'success');
        resetApp();
      } else {
        throw new Error(result.details || result.error || 'Erro desconhecido no servidor.');
      }
    } catch (error) {
      console.error('Erro no envio:', error);
      showStatus(`Falha no envio: ${error.message}`, 'error');
      sendBtn.disabled = false; // Reabilita para nova tentativa
    } finally {
      sendBtn.classList.remove('loading');
    }
  });

  function resetApp() {
    sendBtn.disabled = true;
    audioPlayer.style.display = 'none';
    if (audioPlayer.src) {
        URL.revokeObjectURL(audioPlayer.src);
    }
    audioPlayer.src = '';
    recordedBlob = null;
    audioChunks = [];
    startBtn.disabled = false;
  }
});