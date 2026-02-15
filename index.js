const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Preference } = require("mercadopago");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json());
app.use(cors());

// 1. Configuración de Mercado Pago
const client = new MercadoPagoConfig({ 
  accessToken: "APP_USR-5718871151573243-021417-1d7e37013b7e3a90075d5d2a77709653-310958737" 
});

// 2. Enlace de MongoDB
const mongoUri = "mongodb+srv://admin:Ge5BVDpLP4hxLCbk@cluster0.snqb1nh.mongodb.net/?appName=Cluster0";
const dbClient = new MongoClient(mongoUri);

// 3. Configuración de Correos
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: "housereconquista@gmail.com", pass: "sdvcldsouxffmtut" }
});

// Función interna para guardar en la base de datos
const guardarReserva = async (datos) => {
  try {
    await dbClient.connect();
    const database = dbClient.db("CasaReconquista");
    const reservas = database.collection("reservas");
    await reservas.insertOne({
      ...datos,
      fechaRegistro: new Date()
    });
    console.log("✅ Reserva guardada en MongoDB");
  } catch (error) {
    console.error("❌ Error al guardar en DB:", error);
  }
};

// --- RUTAS ---

// Ruta para crear el pago (Frontend -> Mercado Pago)
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

// Webhook: Recibe la confirmación de pago y guarda en la base de datos
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
        // Guardamos los datos para el Panel de Desempeño
        await guardarReserva({
          huesped: data.payer.first_name || "Cliente",
          email: data.payer.email,
          monto: data.transaction_amount,
          habitacion: data.description,
          metodo: "Mercado Pago"
        });

        // Enviamos el mail de confirmación
        await transporter.sendMail({
          from: '"House Reconquista" <housereconquista@gmail.com>',
          to: `housereconquista@gmail.com, ${data.payer.email}`,
          subject: `✅ Reserva Confirmada - ${data.description}`,
          html: `<h2>¡Pago recibido!</h2><p>Gracias ${data.payer.first_name}, tu reserva por <b>${data.description}</b> ha sido confirmada por $${data.transaction_amount} ARS.</p>`
        });
      }
    } catch (err) { console.error("Error en Webhook:", err); }
  }
  res.sendStatus(200);
});

// NUEVA RUTA: Entrega los datos al Admin Panel de React
app.get("/obtener-reservas", async (req, res) => {
  try {
    await dbClient.connect();
    const database = dbClient.db("CasaReconquista");
    const reservas = database.collection("reservas");
    
    // Traemos todo el historial ordenado por lo más nuevo
    const listaReservas = await reservas.find({}).sort({ fechaRegistro: -1 }).toArray();
    res.json(listaReservas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener datos de la base" });
  }
});

app.listen(3001, () => { 
  console.log("🚀 Servidor vinculado a MongoDB y listo para el Admin Panel"); 
});