const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const {
  saveMessage,
  getMessagesByRoom,
  saveSuiteStatus,
  getSuiteStatus,
  updateSuiteMessageActivity,
  getValidSuiteStatuses,
  sortSuitesForQueue
} = require("./services/dynamoService");

const {
  translateText
} = require("./services/translateService");

require("dotenv").config();

const app = express();

app.use(express.json());

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"],
  methods: ["GET", "POST", "PUT"]
}));

app.get("/", (req, res) => {
  res.json({
    message: "HConnect backend running with DynamoDB"
  });
});

const server = http.createServer(app);

/*
|--------------------------------------------------------------------------
| Active Rooms
|--------------------------------------------------------------------------
*/

const activeRooms = new Set();
const activeClientSockets = new Map();

function normalizeRoomId(roomId) {
  const suiteId = String(roomId || "").replace(/^room-/, "");

  return `room-${suiteId}`;
}

app.get("/rooms", (req, res) => {
  res.json({
    rooms: Array.from(activeRooms)
  });
});

async function getActiveSuiteQueue() {
  const uniqueRooms = Array.from(
    new Set(Array.from(activeRooms).map((roomId) => normalizeRoomId(roomId)))
  );

  const suiteStatuses = await Promise.all(
    uniqueRooms.map(async (roomId) => {
      const suiteStatus = await getSuiteStatus(roomId);

      return suiteStatus || {
        suiteId: roomId.replace(/^room-/, ""),
        roomId,
        status: "waiting",
        updatedAt: null,
        updatedBy: null,
        priority: "normal",
        vip: false,
        lastMessageAt: null,
        unresolvedCount: 0
      };
    })
  );

  const uniqueSuites = Array.from(
    suiteStatuses
      .reduce((acc, suite) => {
        acc.set(suite.suiteId, {
          ...suite,
          roomId: normalizeRoomId(suite.roomId)
        });

        return acc;
      }, new Map())
      .values()
  );

  return sortSuitesForQueue(uniqueSuites);
}

async function emitSuiteOperationalUpdates(suiteStatus) {
  const queue = await getActiveSuiteQueue();

  io.emit("suiteStatusUpdated", suiteStatus);
  io.emit("queueUpdated", queue);
}

/*
|--------------------------------------------------------------------------
| Suite Status
|--------------------------------------------------------------------------
*/

app.get("/suites/statuses", (req, res) => {
  res.json({
    statuses: getValidSuiteStatuses()
  });
});

app.get("/suites/queue", async (req, res) => {
  try {
    const queue = await getActiveSuiteQueue();

    res.json({
      suites: queue
    });
  } catch (error) {
    console.error("Error al obtener queue de suites:", error);

    res.status(500).json({
      message: "Error al obtener queue de suites"
    });
  }
});

app.get("/suites/:suiteId", async (req, res) => {
  try {
    const suiteStatus = await getSuiteStatus(req.params.suiteId);

    if (!suiteStatus) {
      return res.status(404).json({
        message: "Suite not found"
      });
    }

    res.json(suiteStatus);
  } catch (error) {
    console.error("Error al obtener suite:", error);

    res.status(500).json({
      message: "Error al obtener suite"
    });
  }
});

app.get("/suites/:suiteId/status", async (req, res) => {
  try {
    const suiteStatus = await getSuiteStatus(req.params.suiteId);

    if (!suiteStatus) {
      return res.status(404).json({
        message: "Suite status not found"
      });
    }

    res.json(suiteStatus);
  } catch (error) {
    console.error("Error al obtener status de suite:", error);

    res.status(500).json({
      message: "Error al obtener status de suite"
    });
  }
});

async function updateSuiteStatusHandler(req, res) {
  try {
    const {
      status,
      roomId,
      updatedBy,
      priority,
      vip,
      lastMessageAt,
      unresolvedCount
    } = req.body || {};

    if (!status) {
      return res.status(400).json({
        message: "status is required"
      });
    }

    const suiteStatus = await saveSuiteStatus({
      suiteId: req.params.suiteId,
      roomId,
      status,
      updatedBy,
      priority,
      vip,
      lastMessageAt,
      unresolvedCount
    });

    await emitSuiteOperationalUpdates(suiteStatus);

    res.status(201).json(suiteStatus);
  } catch (error) {
    console.error("Error al guardar status de suite:", error);

    const statusCode = error.message?.startsWith("Invalid suite status")
      ? 400
      : 500;

    res.status(statusCode).json({
      message: "Error al guardar status de suite"
    });
  }
}

app.post("/suites/:suiteId/status", updateSuiteStatusHandler);
app.put("/suites/:suiteId/status", updateSuiteStatusHandler);

/*
|--------------------------------------------------------------------------
| Socket.io
|--------------------------------------------------------------------------
*/

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST", "PUT"]
  }
});

io.on("connection", (socket) => {
  const clientId = socket.handshake.auth?.clientId;
  const previousSocketId = clientId ? activeClientSockets.get(clientId) : null;

  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);

    if (previousSocket) {
      previousSocket.disconnect(true);
    }
  }

  if (clientId) {
    activeClientSockets.set(clientId, socket.id);
  }

  console.log(
    "Usuario conectado:",
    socket.id,
    "Cliente:",
    clientId || "sin-client-id",
    "Total activos:",
    io.engine.clientsCount
  );

  /*
  |--------------------------------------------------------------------------
  | Join Room
  |--------------------------------------------------------------------------
  */

  socket.on("joinRoom", async ({ roomId, userType }) => {

    try {
      const normalizedRoomId = normalizeRoomId(roomId);

      socket.join(normalizedRoomId);

      activeRooms.add(normalizedRoomId);

      io.emit("activeRooms", Array.from(activeRooms));
      io.emit("queueUpdated", await getActiveSuiteQueue());

      console.log(`${userType} entró a la sala ${normalizedRoomId}`);

      const history = await getMessagesByRoom(normalizedRoomId);

      socket.emit("chatHistory", history);

      const suiteStatus = await getSuiteStatus(normalizedRoomId);

      if (suiteStatus) {
        socket.emit("suiteStatus", suiteStatus);
      }

    } catch (error) {

      console.error("Error al cargar historial:", error);

      socket.emit("chatHistory", []);
    }
  });
  socket.on("typing", ({ roomId, sender }) => {
    socket.to(roomId).emit("userTyping", {
      sender
    });
  });
  socket.on("stopTyping", ({ roomId }) => {
    socket.to(roomId).emit("userStopTyping");
  });

  /*
  |--------------------------------------------------------------------------
  | Suite Status
  |--------------------------------------------------------------------------
  */

  socket.on("updateSuiteStatus", async (data) => {
    try {
      const suiteId = data.suiteId || data.roomId;

      if (!suiteId || !data.status) {
        socket.emit("suiteStatusError", {
          message: "suiteId/roomId and status are required"
        });

        return;
      }

      const suiteStatus = await saveSuiteStatus({
        suiteId,
        roomId: data.roomId || suiteId,
        status: data.status,
        updatedBy: data.updatedBy || data.sender,
        priority: data.priority,
        vip: data.vip,
        lastMessageAt: data.lastMessageAt,
        unresolvedCount: data.unresolvedCount
      });

      await emitSuiteOperationalUpdates(suiteStatus);

      console.log("Status de suite guardado:", suiteStatus);
    } catch (error) {
      console.error("Error al guardar status de suite:", error);

      socket.emit("suiteStatusError", {
        message: "Error al guardar status de suite"
      });
    }
  });
  /*
  |--------------------------------------------------------------------------
  | Send Message
  |--------------------------------------------------------------------------
  */

  socket.on("sendMessage", async (data) => {

    try {

      let sourceLanguage = "es";
      let targetLanguage = "en";

      if (data.sender === "guest") {
        sourceLanguage = "en";
        targetLanguage = "es";
      }

      if (data.sender === "staff") {
        sourceLanguage = "es";
        targetLanguage = "en";
      }

      const translatedText = await translateText(
        data.text,
        sourceLanguage,
        targetLanguage
      );

      const newMessage = {
        roomId: data.roomId,
        timestamp: new Date().toISOString(),
        messageId: uuidv4(),

        sender: data.sender,

        originalText: data.text,
        translatedText: translatedText,

        sourceLanguage,
        targetLanguage
      };

      await saveMessage(newMessage);
      const suiteStatus = await updateSuiteMessageActivity({
        roomId: data.roomId,
        sender: data.sender,
        timestamp: newMessage.timestamp
      });

      console.log("Mensaje traducido guardado:", newMessage);

      io.to(data.roomId).emit("receiveMessage", {
        id: newMessage.messageId,
        roomId: newMessage.roomId,

        sender: newMessage.sender,

        originalText: newMessage.originalText,
        translatedText: newMessage.translatedText,

        timestamp: newMessage.timestamp
      });
      
      io.emit("newRoomMessage", {
      roomId: newMessage.roomId,
      sender: newMessage.sender,
      timestamp: newMessage.timestamp
    });

      await emitSuiteOperationalUpdates(suiteStatus);

    } catch (error) {

      console.error("Error al traducir/guardar mensaje:", error);
    }
  });

  /*
  |--------------------------------------------------------------------------
  | Disconnect
  |--------------------------------------------------------------------------
  */

  socket.on("disconnect", (reason) => {
    if (clientId && activeClientSockets.get(clientId) === socket.id) {
      activeClientSockets.delete(clientId);
    }

    console.log(
      "Usuario desconectado:",
      socket.id,
      "Cliente:",
      clientId || "sin-client-id",
      "Motivo:",
      reason,
      "Total activos:",
      io.engine.clientsCount
    );
  });
});

/*
|--------------------------------------------------------------------------
| Server
|--------------------------------------------------------------------------
*/

const PORT = 4000;

server.listen(PORT, () => {

  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
