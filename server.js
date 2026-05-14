const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const {
  saveMessage,
  getMessagesByRoom
} = require("./services/dynamoService");

const {
  translateText
} = require("./services/translateService");

require("dotenv").config();

const app = express();

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"],
  methods: ["GET", "POST"]
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

app.get("/rooms", (req, res) => {
  res.json({
    rooms: Array.from(activeRooms)
  });
});

/*
|--------------------------------------------------------------------------
| Socket.io
|--------------------------------------------------------------------------
*/

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {

  console.log("Usuario conectado:", socket.id);

  /*
  |--------------------------------------------------------------------------
  | Join Room
  |--------------------------------------------------------------------------
  */

  socket.on("joinRoom", async ({ roomId, userType }) => {

    try {

      socket.join(roomId);

      activeRooms.add(roomId);

      io.emit("activeRooms", Array.from(activeRooms));

      console.log(`${userType} entró a la sala ${roomId}`);

      const history = await getMessagesByRoom(roomId);

      socket.emit("chatHistory", history);

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

    } catch (error) {

      console.error("Error al traducir/guardar mensaje:", error);
    }
  });

  /*
  |--------------------------------------------------------------------------
  | Disconnect
  |--------------------------------------------------------------------------
  */

  socket.on("disconnect", () => {

    console.log("Usuario desconectado:", socket.id);
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