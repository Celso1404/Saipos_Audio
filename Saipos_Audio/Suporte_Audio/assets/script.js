class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recordedBlob = null;
    this.zafClient = null;
    this.conversationId = null; // Adicionado para armazenar o conversationId
    
    this.initializeElements();
    this.initializeZAF();
  }

  initializeElements() {
    this.startBtn = document.getElementById("startBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.audioPlayer = document.getElementById("audioPlayer");
    this.sendDirectBtn = document.getElementById("sendDirectBtn");
    this.statusDiv = document.getElementById("statusDiv");

    this.bindEvents();
  }

  bindEvents() {
    this.startBtn.addEventListener("click", () => this.startRecording());
    this.stopBtn.addEventListener("click", () => this.stopRecording());
    this.sendDirectBtn.addEventListener("click", () => this.sendAudio());
  }

  async initializeZAF() {
    try {
      this.zafClient = ZAFClient.init();
      await this.zafClient.invoke("resize", { width: "100%", height: "400px" });
      this.showStatus("Aplicativo inicializado. Buscando ID da conversa...", "info");
      await this.getAndSetConversationId(); // Tenta obter o ID da conversa ao iniciar
    } catch (error) {
      console.error("Erro ao inicializar ZAF:", error);
      this.showStatus("Erro ao inicializar aplicativo Zendesk", "error");
    }
  }

  showStatus(message, type = "info") {
    const statusClass = type === "error" ? "error" :
                       type === "success" ? "success" :
                       type === "warning" ? "warning" : "info";
    
    this.statusDiv.innerHTML = `<div class="status ${statusClass}">${message}</div>`;
    
    if (type !== "error") {
      setTimeout(() => {
        this.statusDiv.innerHTML = "";
      }, 5000);
    }
  }

  async getTicketId() {
    try {
      const context = await this.zafClient.context();
      
      if (context.ticket && context.ticket.id) {
        return context.ticket.id;
      }
      
      if (context.ticketId) {
        return context.ticketId;
      }
      
      if (context.conversation && context.conversation.id) {
        return context.conversation.id;
      }
      
      if (context.location === "ticket_sidebar") {
        const ticketData = await this.zafClient.get("ticket.id");
        if (ticketData && ticketData["ticket.id"]) {
          return ticketData["ticket.id"];
        }
      }
      
      throw new Error("Ticket ID não encontrado no contexto");
      
    } catch (error) {
      console.error("Erro ao obter ticket ID:", error);
      throw new Error("Não foi possível obter o ID do ticket. Verifique se o aplicativo está sendo executado no contexto correto do Zendesk.");
    }
  }

  // Função para determinar a URL base do backend baseada no protocolo da página
  getBackendBaseUrl() {
    // Se a página está em HTTPS
    const protocol = window.location.protocol;
    const isHttps = protocol === 'https:';
    
    if (isHttps) {
      // Em produção ou ambiente HTTPS, usar HTTPS
      return 'https://localhost:3000';
    } else {
      // Em desenvolvimento local, usar HTTP
      return 'http://localhost:3000';
    }
  }

  async getAndSetConversationId() {
    try {
      const ticketId = await this.getTicketId();
      this.showStatus(`Ticket ID encontrado: ${ticketId}. Buscando Conversation ID...`, "info");

      const backendUrl = this.getBackendBaseUrl();
      console.log(`Fazendo requisição para: ${backendUrl}/conversation-id/${ticketId}`);

      const response = await fetch(`${backendUrl}/conversation-id/${ticketId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // Timeout para corrigir bug do carregamento
        signal: AbortSignal.timeout(30000) // 30 segundos
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        this.conversationId = data.conversationId;
        this.showStatus(`Conversation ID obtido: ${this.conversationId}`, "success");
        this.startBtn.disabled = false; // Habilita o botão de gravação
      } else {
        throw new Error(data.error || "Falha ao obter Conversation ID");
      }
    } catch (error) {
      console.error("Erro ao obter e definir Conversation ID:", error);
      
      let errorMessage = ` Erro ao obter Conversation ID: ${error.message}`;
      
      if (error.name === 'TimeoutError') {
        errorMessage = " Timeout: O servidor não respondeu em 30 segundos.";
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = "Erro de conexão: Não foi possível conectar ao backend.";
      }
      
      this.showStatus(`${errorMessage} O envio de áudio está desabilitado.`, "error");
      this.startBtn.disabled = true; 
    }
  }

  async startRecording() {
    if (!this.conversationId) {
      this.showStatus("Não foi possível iniciar a gravação. Conversation ID não disponível.", "warning");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus"
      });

      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.handleRecordingStop();
      };

      this.mediaRecorder.onerror = (event) => {
        console.error("Erro na gravação:", event.error);
        this.showStatus("Erro durante a gravação: " + event.error, "error");
        this.resetRecordingState();
      };

      this.mediaRecorder.start(1000); 
      
      this.updateUIForRecording(true);
      this.showStatus("Gravação iniciada... Fale agora!", "info");

    } catch (error) {
      console.error("Erro ao acessar microfone:", error);
      let errorMessage = "Erro ao acessar o microfone. ";
      
      if (error.name === "NotAllowedError") {
        errorMessage += "Permissão negada. Verifique as configurações do navegador.";
      } else if (error.name === "NotFoundError") {
        errorMessage += "Microfone não encontrado.";
      } else {
        errorMessage += "Verifique as permissões e tente novamente.";
      }
      
      this.showStatus(errorMessage, "error");
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  }

  handleRecordingStop() {
    this.recordedBlob = new Blob(this.audioChunks, { type: "audio/webm" });
    
    if (this.recordedBlob.size === 0) {
      this.showStatus("Gravação vazia. Tente novamente.", "warning");
      this.resetRecordingState();
      return;
    }

    const audioUrl = URL.createObjectURL(this.recordedBlob);
    this.audioPlayer.src = audioUrl;
    this.audioPlayer.style.display = "block";

    this.updateUIForRecording(false);
    this.sendDirectBtn.disabled = false; // Habilita o botão de envio após a gravação
    
    const duration = this.recordedBlob.size > 1000 ? "Gravação concluída!" : "Gravação muito curta!";
    this.showStatus(`${duration} Pronto para enviar.`, "success");
  }

  updateUIForRecording(isRecording) {
    this.startBtn.disabled = isRecording || !this.conversationId; // Desabilita se estiver gravando ou sem conversationId
    this.stopBtn.disabled = !isRecording;
    this.sendDirectBtn.disabled = isRecording || !this.recordedBlob; // Desabilita se estiver gravando ou sem áudio gravado

    if (isRecording) {
      this.startBtn.classList.add("loading");
    } else {
      this.startBtn.classList.remove("loading");
    }
  }

  resetRecordingState() {
    this.updateUIForRecording(false);
    this.sendDirectBtn.disabled = true;
    this.audioPlayer.style.display = "none";
    this.recordedBlob = null;
  }

  async sendAudio() {
    if (!this.recordedBlob) {
      this.showStatus("Nenhum áudio gravado para enviar.", "warning");
      return;
    }
    if (!this.conversationId) {
      this.showStatus("Não foi possível enviar o áudio. Conversation ID não disponível.", "error");
      return;
    }

    this.sendDirectBtn.disabled = true;
    this.sendDirectBtn.classList.add("loading");

    try {
      this.showStatus("📤 Enviando áudio...", "info");

      const formData = new FormData();
      formData.append("audio", this.recordedBlob, "gravacao.webm");
      formData.append("ticketId", await this.getTicketId()); // Envia o ticketId para o backend

      const backendUrl = this.getBackendBaseUrl();
      console.log(`Enviando áudio para: ${backendUrl}/upload-and-send`);

      const response = await fetch(`${backendUrl}/upload-and-send`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000) // 60 segundos para upload
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        this.showStatus("Áudio enviado com sucesso para a conversa!", "success");
        this.resetAfterSend();
      } else {
        throw new Error(data.error || "Erro desconhecido do servidor");
      }

    } catch (error) {
      console.error("Erro ao enviar áudio:", error);
      
      let errorMessage = `Erro ao enviar áudio: ${error.message}`;
      
      if (error.name === 'TimeoutError') {
        errorMessage = "Timeout: O upload demorou mais de 60 segundos. Tente novamente.";
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = "Erro de conexão: Não foi possível conectar ao backend durante o upload.";
      }
      
      this.showStatus(errorMessage, "error");
    } finally {
      this.sendDirectBtn.disabled = false;
      this.sendDirectBtn.classList.remove("loading");
    }
  }

  resetAfterSend() {
    this.sendDirectBtn.disabled = true;
    this.audioPlayer.style.display = "none";
    this.audioPlayer.src = "";
    this.recordedBlob = null;
    
    if (this.audioPlayer.src.startsWith("blob:")) {
      URL.revokeObjectURL(this.audioPlayer.src);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new AudioRecorder();
});
