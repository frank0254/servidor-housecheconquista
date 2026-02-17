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
let db;

// Conexión inicial a la base de datos
async function connectDB() {
  try {
    await dbClient.connect();
    db = dbClient.db("CasaReconquista");
    console.log("⭐ Conectado exitosamente a MongoDB Atlas");
  } catch (error) {
    console.error("❌ Error conectando a MongoDB:", error);
  }
}
connectDB();

// 3. Configuración de Correos (Nodemailer)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { 
    user: "housereconquista@gmail.com", 
    pass: "sdvcldsouxffmtut" 
  }
});

// --- RUTAS ---

// Ruta para crear el pago (Frontend -> Mercado Pago)
app.post("/create_preference", async (req, res) => {
  try {
    const { amountInUSD, description, customer, habitacion } = req.body;

    // Obtener cotización del Dólar Blue para el cobro en ARS
    const responseDolar = await fetch("https://dolarapi.com/v1/dolares/blue");
    const datosDolar = await responseDolar.json();
    const amountInARS = Math.round(amountInUSD * datosDolar.compra);

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{ 
          title: description, 
          quantity: 1, 
          unit_price: amountInARS, 
          currency_id: "ARS" 
        }],
        payer: { 
          email: customer.email, 
          name: customer.name 
        },
        // METADATA: Aquí guardamos la info que queremos recuperar en el webhook
        metadata: {
          huesped_nombre: customer.name,
          huesped_email: customer.email,
          habitacion_reserva: habitacion,
          monto_dolares: amountInUSD
        },
        notification_url: "https://servidor-housecheconquista.onrender.com/webhook",
        back_urls: {
          success: "https://casareconquista.com/success", // Cambia por tu URL real
          failure: "https://casareconquista.com/rooms"
        },
        auto_return: "approved",
      },
    });

    res.json({ init_point: result.init_point });
  } catch (error) { 
    console.error("Error al crear preferencia:", error);
    res.status(500).json({ error: error.message }); 
  }
});

// Webhook: Recibe la confirmación real de Mercado Pago
app.post("/webhook", async (req, res) => {
  const { query } = req;
  const topic = query.topic || query.type;

  if (topic === "payment") {
    const paymentId = query.id || query['data.id'];
    
    try {
      // Consultamos los detalles del pago a Mercado Pago
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer APP_USR-5718871151573243-021417-1d7e37013b7e3a90075d5d2a77709653-310958737` }
      });
      const data = await response.json();

      if (data.status === "approved") {
        // Extraemos la info de la metadata que enviamos en create_preference
        const infoExtra = data.metadata;

        // --- GENERAMOS EL NÚMERO DE RESERVA ALEATORIO ---
        const nroReserva = Math.floor(100000 + Math.random() * 900000);

        const reservaFinal = {
          nroReserva: nroReserva,
          huesped: infoExtra.huesped_nombre || "Cliente",
          email: infoExtra.huesped_email,
          monto: data.transaction_amount, // Monto en Pesos
          montoUSD: infoExtra.monto_dolares, // Monto en Dólares original
          habitacion: infoExtra.habitacion_reserva,
          fechaRegistro: new Date(),
          metodo: "Mercado Pago",
          paymentId: paymentId
        };

        // 1. Guardar en MongoDB
        if (db) {
          await db.collection("reservas").insertOne(reservaFinal);
          console.log(`✅ Reserva #${nroReserva} guardada en MongoDB`);
        }

        // 2. Enviar mail de confirmación (Doble destinatario)
        await transporter.sendMail({
          from: '"Casa Reconquista" <housereconquista@gmail.com>',
          to: `housereconquista@gmail.com, ${infoExtra.huesped_email}`,
          subject: `✅ Reserva #${nroReserva} Confirmada - ${infoExtra.habitacion_reserva}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
              <h2 style="color: #e91e63;">¡Nueva Reserva Confirmada!</h2>
              <p>Hola <b>${infoExtra.huesped_nombre}</b>,</p>
              <p>Tu pago para la habitación <b>${infoExtra.habitacion_reserva}</b> ha sido procesado con éxito.</p>
              <p>Tu número de reserva es: <b>#${nroReserva}</b></p>
              <hr />
              <p><b>Detalles de la operación:</b></p>
              <ul>
                <li>Monto total: $${data.transaction_amount} ARS</li>
                <li>Equivalente en dólares: USD $${infoExtra.monto_dolares}</li>
                <li>ID de pago: ${paymentId}</li>
              </ul>
              <p>Por favor conserva este número para tu llegada. Nos pondremos en contacto pronto.</p>
              <p><i>Atentamente, el equipo de Casa Reconquista.</i></p>
            </div>
          `
        });
        console.log("📧 Mails de confirmación con Nro de Reserva enviados");
      }
    } catch (err) { 
      console.error("❌ Error en el proceso del Webhook:", err); 
    }
  }
  // Respondemos 200 siempre para que Mercado Pago no reintente el envío
  res.sendStatus(200);
});

// Ruta para el Admin Panel: Obtiene todas las reservas guardadas
app.get("/obtener-reservas", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: "Base de datos no conectada" });
    }
    const reservasCol = db.collection("reservas");
    const lista = await reservasCol.find({}).sort({ fechaRegistro: -1 }).toArray();
    res.json(lista);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener datos de MongoDB" });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => { 
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`); 
});