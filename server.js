const express = require("express");
const { google } = require("googleapis");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN_PATH = process.env.TOKEN_PATH || "./token.json";

// Google OAuth configuration
const oauth2Client = new google.auth.OAuth2({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI,
});

// Google OAuth login endpoint
app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  });

  res.redirect(authUrl);
});

// Google OAuth callback endpoint
app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Storing Tokens
    fs.writeFile(TOKEN_PATH, JSON.stringify(tokens), (err) => {
      if (err) console.error("Error writing token to file:", err);
      console.log("Token stored to", TOKEN_PATH);
    });

    res.send("Authentication successful! You can now start using the app.");
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Main logic for checking and responding to emails
async function checkAndRespond() {
  const tokens = fs.readFileSync(TOKEN_PATH);
  oauth2Client.setCredentials(JSON.parse(tokens));

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox is:unread category:primary",
    });

    const messages = response.data.messages;
    if (messages && messages.length > 0) {
      for (const message of messages) {
        const threadId = message.threadId;

        // Check if there is no prior reply in this thread
        const replies = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
        });

        if (replies.data.messages.length === 1) {
          const sender = replies.data.messages[0].payload.headers.find(
            (header) => header.name === "From"
          ).value;

          // Send a reply to the sender
          await sendAutoReply(gmail, message.id, sender);

          // Add a label to the email
          await addLabel(gmail, message.id, "AutoReplied");

          console.log(`Replied to email with ID: ${message.id}`);
        } else {
          console.log(
            `Email with ID ${message.id} already replied or no prior replies`
          );
        }
      }
    }
  } catch (error) {
    console.error("Error checking and responding to emails:", error);
  }
}

// Send an auto-reply to the specified recipient
async function sendAutoReply(gmail, messageId, recipient) {
  const emailContent = {
    to: recipient,
    subject: "Re: AutoGenerated Reply",
    text: "Thank you for your email. I am currently out of the office and will respond as soon as possible.",
  };

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: createMessage(emailContent),
      threadId: messageId,
    },
  });
}

// Add a label to the email
async function addLabel(gmail, messageId, labelName) {
  const labelId = await getOrCreateLabelId(gmail, labelName);

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
    },
  });
}

// Get or create a label and return its ID
async function getOrCreateLabelId(gmail, labelName) {
  const labels = await gmail.users.labels.list({
    userId: "me",
  });

  const existingLabel = labels.data.labels.find(
    (label) => label.name === labelName
  );

  if (existingLabel) {
    return existingLabel.id;
  } else {
    const createdLabel = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
      },
    });

    return createdLabel.data.id;
  }
}

// Create a base64-encoded email message
function createMessage(emailContent) {
  const raw = [
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
    "Content-Transfer-Encoding: 7bit",
    `to: ${emailContent.to}`,
    `subject: ${emailContent.subject}`,
    "",
    emailContent.text,
  ].join("\n");

  return Buffer.from(raw).toString("base64");
}

// Set up interval for repeating the logic
function getRandomInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

setInterval(() => {
  checkAndRespond();
}, getRandomInterval(45, 120) * 1000);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
