const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const FormData = require("form-data");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Usando node-fetch v2 que suporta require
const https = require("https" );
const constants = require("constants");

const app = express();
const PORT = 3000;

// ================= CONFIGURAÇÕES GERAIS =================
// --- ZENDESK AUDITS API ---
const ZENDESK_SUBDOMAIN = "teste-31756";
const ZENDESK_API_USER = "celso.bitello@saipos.com";
const ZENDESK_API_TOKEN = "TRq5k7tskPjNpjyZIjN8jyngrljKCHD8RBIPx3EG";
const ZENDESK_BASE_URL = `https://${ZENDESK_SUBDOMAIN}.zendesk.com`;

// --- SUNSHINE CONVERSATIONS API ---
const APP_ID = "68b50560c377eef7103df385";
const API_KEY = "app_68b78526e24cb60f519d7a0b";
const API_SECRET = "PCm985xQDXG0GJGwFffdIfKtP-IFGl5ZF6hShRXPuHnV7XCtVa16UM8lVlOyumUMjFdN7SCA_JarOW1QDVty3A";
const SUNSHINE_BASE_URL = "https://api.smooch.io";
// =======================================================

// Pasta para uploads temporários
const uploadDir = path.join(__dirname, "uploads" );
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `audio-${uniqueSuffix}.webm`);
  },
});
const upload = multer({ storage });

// Configuração de segurança HTTPS 
const httpsAgent = new https.Agent({
  secureProtocol: 'TLSv1_2_method',
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384',
  honorCipherOrder: true,
  secureOptions: constants.SSL_OP_NO_SSLv2 | constants.SSL_OP_NO_SSLv3,
} );

// Middlewares
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadDir)); // Servir arquivos estáticos (se necessário)

// Funções de Autenticação
const createSunshineAuth = () => `Basic ${Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')}`;
const createZendeskAuth = () => `Basic ${Buffer.from(`${ZENDESK_API_USER}/token:${ZENDESK_API_TOKEN}`).toString('base64')}`;

// Função para buscar o Conversation ID via API de Audits do Zendesk
async function getConversationIdFromTicket(ticketId) {
  const url = `${ZENDESK_BASE_URL}/api/v2/tickets/${ticketId}/audits.json`;
  console.log(`Buscando audits para o ticket ${ticketId} em: ${url}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: createZendeskAuth(), "Content-Type": "application/json" },
      agent: httpsAgent,
    } );

    if (!response.ok) {
      throw new Error(`Erro na API Zendesk: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    for (const audit of data.audits.reverse()) { // Começa do mais recente
      for (const event of audit.events) {
        if (event.conversation_id) {
          console.log(`Conversation ID encontrado: ${event.conversation_id}`);
          return event.conversation_id;
        }
        if (event.value && event.value.conversation_id) {
          console.log(`Conversation ID encontrado em event.value: ${event.value.conversation_id}`);
          return event.value.conversation_id;
        }
      }
    }
    throw new Error("Conversation ID não encontrado nos audits do ticket.");
  } catch (error) {
    console.error("Erro ao buscar conversation_id:", error);
    throw error;
  }
}

// Rota principal para upload e envio do áudio
app.post("/upload-and-send", upload.single("audio"), async (req, res) => {
  console.log("Recebida requisição em /upload-and-send");

  if (!req.file) {
    return res.status(400).json({ success: false, error: "Nenhum arquivo de áudio enviado." });
  }

  const { ticketId } = req.body;
  if (!ticketId) {
    fs.unlinkSync(req.file.path); // Limpa o arquivo
    return res.status(400).json({ success: false, error: "O ticketId é obrigatório." });
  }

  let conversationId;
  try {
    // Obter o Conversation ID
    conversationId = await getConversationIdFromTicket(ticketId);

    // Fazer upload do anexo para a Sunshine Conversations 
    const formData = new FormData();
    formData.append('source', fs.createReadStream(req.file.path));
    
    const uploadUrl = `${SUNSHINE_BASE_URL}/v2/apps/${APP_ID}/attachments?access=public&for=message&conversationId=${conversationId}`;
    console.log("Enviando anexo para SunCo...");

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: createSunshineAuth(),
        ...formData.getHeaders(),
      },
      body: formData,
      agent: httpsAgent,
    } );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Falha no upload do anexo para SunCo: ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    const mediaUrl = uploadData.attachment.mediaUrl;
    console.log(`Anexo enviado. Media URL: ${mediaUrl}`);

    // Enviar áudio
    const messageUrl = `${SUNSHINE_BASE_URL}/v2/apps/${APP_ID}/conversations/${conversationId}/messages`;
    console.log("Enviando mensagem de áudio...");

    const messageResponse = await fetch(messageUrl, {
      method: "POST",
      headers: {
        Authorization: createSunshineAuth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        author: { type: "business" },
        content: { type: "file", mediaUrl: mediaUrl, altText: "Mensagem de áudio" },
      }),
      agent: httpsAgent,
    } );

    if (!messageResponse.ok) {
      const errorText = await messageResponse.text();
      throw new Error(`Falha no envio da mensagem para SunCo: ${errorText}`);
    }

    const messageData = await messageResponse.json();
    console.log("Mensagem enviada com sucesso!");

    // 4. Responder ao cliente e limpar
    res.json({ success: true, message: "Áudio enviado com sucesso!", data: messageData });

  } catch (error) {
    console.error("Erro no processo de envio:", error);
    res.status(500).json({ success: false, error: "Falha interna do servidor.", details: error.message });
  } finally {
    // Limpar áudio
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`Arquivo temporário ${req.file.filename} removido.`);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor unificado rodando na porta ${PORT}`);
});