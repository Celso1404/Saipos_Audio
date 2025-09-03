const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const https = require("https");
const constants = require("constants");

const app = express();
const PORT = 3000;

const uploadDir = path.join(__dirname, "uploads");

// ================= CONFIG ZENDESK AUDITS API =================
const ZENDESK_SUBDOMAIN = "teste-31756"; // Extraído do log fornecido
const ZENDESK_API_USER = "celso.bitello@saipos.com"; // Configurar com email do usuário
const ZENDESK_API_TOKEN = "TRq5k7tskPjNpjyZIjN8jyngrljKCHD8RBIPx3EG"; // Configurar com token da API
const ZENDESK_BASE_URL = `https://${ZENDESK_SUBDOMAIN}.zendesk.com`;

// ================= CONFIG SUNSHINE CONVERSATION =================
const APP_ID = "68b50560c377eef7103df385"; // Do log fornecido
const API_KEY = "app_68b78526e24cb60f519d7a0b"; // Do log fornecido
const API_SECRET = "PCm985xQDXG0GJGwFffdIfKtP-IFGl5ZF6hShRXPuHnV7XCtVa16UM8lVlOyumUMjFdN7SCA_JarOW1QDVty3A";
const SUNSHINE_BASE_URL = "https://api.smooch.io";
// =================================================================

// Configuração SSL/TLS para resolver problemas de handshake
const httpsAgent = new https.Agent({
  secureProtocol: 'TLSv1_2_method', // Força TLS 1.2
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384',
  honorCipherOrder: true,
  secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3,
  rejectUnauthorized: true
});

// Criar pasta de uploads se não existir
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configuração do multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `audio-${uniqueSuffix}.ogg`);
  },
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

// Função para criar credenciais Basic Auth para Sunshine Conversations
function createSunshineAuth() {
  const credentials = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  return `Basic ${credentials}`;
}

// Função para criar credenciais Basic Auth para Zendesk API
function createZendeskAuth() {
  const credentials = Buffer.from(`${ZENDESK_API_USER}/token:${ZENDESK_API_TOKEN}`).toString('base64');
  return `Basic ${credentials}`;
}

// Função para buscar conversation_id via API Audits
async function getConversationIdFromTicket(ticketId) {
  try {
    console.log(`Buscando audits para ticket ${ticketId}...`);
    const response = await fetch(
      `${ZENDESK_BASE_URL}/api/v2/tickets/${ticketId}/audits.json`,
      {
        method: "GET",
        headers: {
          Authorization: createZendeskAuth(),
          "Content-Type": "application/json",
        },
        agent: httpsAgent // Usar o agente HTTPS configurado
      }
    );

    if (!response.ok) {
      throw new Error(`Erro ao buscar audits: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Encontrados ${data.audits.length} audits para o ticket ${ticketId}`);
    
    // Procurar por conversation_id nos eventos dos audits
    for (const audit of data.audits) {
      console.log(`Verificando audit ${audit.id} com ${audit.events.length} eventos...`);
      
      for (const event of audit.events) {
        console.log(`Verificando evento tipo: ${event.type}`);
        
        // Verificar se há conversation_id diretamente no evento
        if (event.conversation_id) {
          console.log(`Conversation ID encontrado diretamente no evento: ${event.conversation_id}`);
          return event.conversation_id;
        }
        
        // Verificar se o evento tem uma estrutura 'value' com conversation_id
        if (event.value && typeof event.value === 'object') {
          if (event.value.conversation_id) {
            console.log(`Conversation ID encontrado em event.value: ${event.value.conversation_id}`);
            return event.value.conversation_id;
          }
          
          // Verificar se há conversation_id aninhado em outros objetos dentro de value
          if (event.value.initiator && event.value.initiator.conversation_id) {
            console.log(`Conversation ID encontrado em event.value.initiator: ${event.value.initiator.conversation_id}`);
            return event.value.initiator.conversation_id;
          }
        }
      }
    }
    
    console.log("Nenhum conversation_id encontrado nos audits");
    throw new Error("Conversation ID não encontrado nos audits do ticket");
  } catch (error) {
    console.error("Erro ao buscar conversation_id:", error);
    throw error;
  }
}

// Rota principal
app.get("/", (req, res) => {
  res.send("Servidor rodando com Sunshine Conversation API e integração Audits.");
});

// Rota para buscar conversation_id de um ticket
app.get("/conversation-id/:ticketId", async (req, res) => {
  const { ticketId } = req.params;

  try {
    const conversationId = await getConversationIdFromTicket(ticketId);
    res.json({ 
      success: true, 
      ticketId, 
      conversationId 
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Falha ao obter conversation_id", 
      details: error.message 
    });
  }
});

// Upload do áudio e envio via Sunshine Conversation (versão com SSL corrigido)
app.post("/upload-and-send", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  const { ticketId } = req.body;

  if (!ticketId) {
    return res.status(400).json({ error: "ticketId é obrigatório." });
  }

  try {
    // Passo 1: Obter conversation_id via API Audits
    console.log(`Buscando conversation_id para ticket ${ticketId}...`);
    const conversationId = await getConversationIdFromTicket(ticketId);
    console.log(`Conversation ID encontrado: ${conversationId}`);

    // Passo 2: Upload do anexo para Sunshine Conversation (com SSL corrigido)
    const formData = new FormData();
    formData.append('source', fs.createReadStream(req.file.path));

    console.log(`📤 Fazendo upload do arquivo: ${req.file.filename}`);
    console.log(`📊 Tamanho do arquivo: ${req.file.size} bytes`);
    console.log(`🎵 Tipo MIME: ${req.file.mimetype}`);

    const uploadResponse = await fetch(
      `${SUNSHINE_BASE_URL}/v2/apps/${APP_ID}/attachments?access=public&for=message&conversationId=${conversationId}`,
      {
        method: "POST",
        headers: {
          Authorization: createSunshineAuth(),
          ...formData.getHeaders(),
        },
        body: formData,
        agent: httpsAgent // Usar o agente HTTPS configurado
      }
    );

    console.log(`Status do upload: ${uploadResponse.status}`);
    const responseText = await uploadResponse.text();
    console.log(`Corpo da resposta do upload: ${responseText}`);

    if (!uploadResponse.ok) {
      console.error("Erro no upload do anexo:", responseText);
      return res.status(uploadResponse.status).json({ 
        error: "Falha no upload do anexo", 
        details: responseText 
      });
    }

    const uploadData = JSON.parse(responseText);
    const mediaUrl = uploadData.attachment.mediaUrl;

    // Passo 3: Enviar mensagem de áudio
    const messageResponse = await fetch(
      `${SUNSHINE_BASE_URL}/v2/apps/${APP_ID}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: createSunshineAuth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          author: {
            type: "business"
          },
          content: {
            type: "file",
            mediaUrl: mediaUrl
          }
        }),
        agent: httpsAgent // Usar o agente HTTPS configurado
      }
    );

    if (!messageResponse.ok) {
      const errorData = await messageResponse.text();
      console.error("Erro no envio da mensagem:", errorData);
      return res.status(messageResponse.status).json({ 
        error: "Falha no envio da mensagem", 
        details: errorData 
      });
    }

    const messageData = await messageResponse.json();

    // Limpar arquivo local após envio bem-sucedido
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: "Áudio enviado com sucesso!",
      data: {
        ticketId,
        conversationId,
        attachment: uploadData.attachment,
        message: messageData.message
      }
    });

  } catch (error) {
    console.error("Erro geral:", error);
    res.status(500).json({ 
      error: "Falha interna do servidor", 
      details: error.message 
    });
  }
});

// Rota para upload simples (sem envio)
app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
  return res.json({ downloadUrl: fileUrl });
});

// Rota para enviar áudio já hospedado via Sunshine Conversation
app.post("/send-audio", async (req, res) => {
  const { ticketId, audioUrl } = req.body;

  if (!ticketId || !audioUrl) {
    return res.status(400).json({ 
      error: "ticketId e audioUrl são obrigatórios." 
    });
  }

  try {
    // Obter conversation_id via API Audits
    const conversationId = await getConversationIdFromTicket(ticketId);

    const response = await fetch(
      `${SUNSHINE_BASE_URL}/v2/apps/${APP_ID}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: createSunshineAuth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          author: {
            type: "business"
          },
          content: {
            type: "file",
            mediaUrl: audioUrl
          }
        }),
        agent: httpsAgent // Usar o agente HTTPS configurado
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Erro no envio:", errorData);
      return res.status(response.status).json({ 
        error: "Falha no envio da mensagem", 
        details: errorData 
      });
    }

    const data = await response.json();
    res.json({
      success: true,
      message: "Áudio enviado com sucesso!",
      data: {
        ticketId,
        conversationId,
        message: data.message
      }
    });

  } catch (error) {
    console.error("Erro ao enviar áudio:", error);
    res.status(500).json({ 
      error: "Falha interna do servidor", 
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Configurado para usar Sunshine Conversation API`);
  console.log(`Sunshine Base URL: ${SUNSHINE_BASE_URL}`);
  console.log(`Zendesk Base URL: ${ZENDESK_BASE_URL}`);
  console.log(`App ID: ${APP_ID}`);
  console.log("IMPORTANTE: Configure ZENDESK_API_USER e ZENDESK_API_TOKEN para usar a API Audits");
  console.log("SSL/TLS: Configurado para TLS 1.2 com ciphers seguros");
});
