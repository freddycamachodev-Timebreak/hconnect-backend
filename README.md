# HCONNECT Backend

Backend API for the HCONNECT platform.

This service is responsible for:

* Real-time chat communication
* AWS Bedrock integration
* Conversation orchestration
* Translation handling
* DynamoDB persistence
* WebSocket / Socket communication
* Staff and guest synchronization

---

## Technologies

* Node.js
* Express.js
* AWS Bedrock
* DynamoDB
* Amazon Translate
* WebSockets / Socket.IO
* REST APIs

---

## Project Structure

```bash
services/
server.js
package.json
```

---

## Installation

```bash
npm install
```

---

## Environment Variables

Create a `.env` file:

```env
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
BEDROCK_MODEL_ID=
PORT=3000
```

---

## Run Development Server

```bash
node server.js
```

or

```bash
npm start
```

---

## Features

* AI-powered hospitality assistant
* Real-time multilingual communication
* Translation support
* Context persistence
* Staff escalation flow
* Ticket integration ready
* Scalable cloud architecture

---

## Architecture Vision

HCONNECT is designed as a scalable hospitality communication platform focused on:

* Guest experience
* AI assistance
* Human fallback support
* Cloud-native architecture
* Multi-language support

---

## Author

Freddy Camacho
