const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Preference } = require("mercadopago");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb"); // Nueva herramienta instalada
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json());
app.use(cors());

// 1. Configuración de Mercado Pago
const client = new MercadoPagoConfig({ 
  accessToken: "APP_USR-5718871151573243-021417-1d7e37013b7e3a90075d5d2a77709653-310958737" 
});

// 2. Enlace de MongoDB (Tu llave que copiaste)
const mongoUri = "mongodb+srv://admin:Ge5BVDpLP4hxLCbk@cluster0.snqb1nh.mongodb.net/?appName=Cluster0";
const dbClient = new MongoClient(mongoUri);

// 3. Configuración de Correos
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: "housereconquista@gmail.com", pass: "sdvcldsouxffmtut" }
});

// Función para guardar en la base de datos
const guardarReserva = async (datos) => {
  try {
    await dbClient.connect();
    const database = dbClient.db("CasaReconquista");
    const reservas = database.collection("reservas");
    await reservas.insertOne({
      ...datos,
      fechaRegistro: new Date()
    });
    console.log("✅ Reserva guardada en el historial");
  } catch (error) {
    console.error("❌ Error al guardar en DB:", error);
  }
};

// ... (Ruta /create_preference igual que antes)
app.post("/create_preference", async (req, res) => {
  try {
    const { amountInUSD, description, customer } = req.body;
    const responseDolar = await fetch("https://dolarapi.com/v1/dolares/blue");
    const datosDolar = await responseDolar.json();
    const amountInARS = Math.round(amountInUSD * datosDolar.compra);

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{ title: description, quantity: 1, unit_price: amountInARS, currency_id: "ARS" }],
        payer: { email: customer.email, name: customer.name },
        notification_url: "https://servidor-housecheconquista.onrender.com/webhook" 
      },
    });
    res.json({ init_point: result.init_point });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Webhook actualizado: Ahora guarda datos para el Calendario y Desempeño
app.post("/webhook", async (req, res) => {
  const { query } = req;
  if (query.type === "payment" || query.topic === "payment") {
    const paymentId = query.id || query['data.id'];
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer APP_USR-5718871151573243-021417-1d7e37013b7e3a90075d5d2a77709653-310958737` }
      });
      const data = await response.json();

      if (data.status === "approved") {
        // AHORA GUARDAMOS LOS DATOS PARA TU HERMANA
        await guardarReserva({
          huesped: data.payer.first_name || "Cliente",
          email: data.payer.email,
          monto: data.transaction_amount,
          habitacion: data.description,
          metodo: "Mercado Pago"
        });

        // Enviamos el mail como antes
        await transporter.sendMail({
          from: '"Housecheconquista" <housereconquista@gmail.com>',
          to: `housereconquista@gmail.com, ${data.payer.email}`,
          subject: `✅ Reserva Confirmada - ${data.description}`,
          html: `<h2>¡Pago recibido!</h2><p>Monto: $${data.transaction_amount} ARS</p>`
        });
      }
    } catch (err) { console.error("Error:", err); }
  }
  res.sendStatus(200);
});

app.listen(3001, () => { console.log("🚀 Servidor con Base de Datos listo"); });