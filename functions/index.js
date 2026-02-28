const admin = require("firebase-admin");
const axios = require("axios");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();

/**
 * Helper function: Convert gs:// URL to public HTTPS URL
 */
async function getPublicUrl(gsUrl) {
  if (!gsUrl.startsWith('gs://')) {
    // Already an HTTP/HTTPS URL
    return gsUrl;
  }

  try {
    console.log("🔄 Converting Firebase Storage URL...");
    
    // Parse gs://bucket/path/to/file.jpg
    const gsPath = gsUrl.replace('gs://', '');
    const firstSlash = gsPath.indexOf('/');
    const bucketName = gsPath.substring(0, firstSlash);
    const filePath = gsPath.substring(firstSlash + 1);
    
    console.log("📦 Bucket:", bucketName);
    console.log("📁 File:", filePath);
    
    // Get reference to file
    const bucket = admin.storage().bucket(bucketName);
    const file = bucket.file(filePath);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    
    // Make file public (if not already)
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(filePath)}`;
    
    console.log("✅ Public URL:", publicUrl);
    return publicUrl;
    
  } catch (error) {
    console.error("❌ Error converting gs:// URL:", error.message);
    throw error;
  }
}

/**
 * TRIGGER: Runs when a new charger usage record is created.
 * Uses Plate Recognizer and sends an FCM Topic notification.
 */
exports.alertBlockedCharger = onDocumentCreated(
  { document: "chargerUsage/{docId}", region: "us-central1" }, 
  async (event) => {
    const plateApiKey = process.env.PLATE_RECOGNIZER_KEY;
    const data = event.data?.data();

    console.log("🔥 TRIGGER FIRED:", event.id);

    if (!data || !data.imageUrl || !plateApiKey) {
      console.error("❌ Missing data, image, or API Key.");
      console.log("Data:", data);
      console.log("Has API Key:", !!plateApiKey);
      return;
    }

    try {
      console.log("📸 Original Image URL:", data.imageUrl);
      
      // Convert gs:// to https:// if needed
      let imageUrl = data.imageUrl;
      if (imageUrl.startsWith('gs://')) {
        imageUrl = await getPublicUrl(imageUrl);
      }
      
      console.log("🔍 Calling Plate Recognizer API...");
      console.log("🌐 Using URL:", imageUrl);

      // 1. Plate Recognition API call
      const response = await axios.post(
        "https://api.platerecognizer.com/v1/plate-reader/",
        { 
          upload_url: imageUrl,
          regions: ["gb"] 
        },
        { 
          headers: { Authorization: `Token ${plateApiKey}` },
          timeout: 30000 // 30 second timeout
        }
      );

      console.log("✅ API Response received");

      const results = response.data?.results || [];
      if (results.length === 0) {
        console.log("⚠️  No plate detected in image");
        return;
      }

      const detectedPlate = results[0].plate.toUpperCase().replace(/\s/g, "");
      const confidence = results[0].score;
      
      console.log("📋 Detected plate:", detectedPlate);
      console.log("🎯 Confidence:", (confidence * 100).toFixed(1) + "%");

      // 2. Lookup owner to get their ID
      console.log("🔍 Looking up owner in database...");
      const plateQuery = await db.collection("userPlates")
        .where("plate", "==", detectedPlate)
        .limit(1)
        .get();

      if (plateQuery.empty) {
        console.log("⚠️  No registered user for plate:", detectedPlate);
        
        // Log unregistered plate for admin review
        await db.collection("unregisteredPlates").add({
          plate: detectedPlate,
          imageUrl: data.imageUrl,
          location: data.location,
          chargerId: data.chargerId,
          reportedBy: data.reportedBy,
          confidence: confidence,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return;
      }

      const ownerData = plateQuery.docs[0].data();
      const ownerId = ownerData.userId;
      
      console.log("👤 Found owner:", ownerId);

      // 3. Send to TOPIC
      const message = {
        notification: {
          title: "Charger Occupied",
          body: `Charger ${data.chargerId || "Unknown"} is now used by ${detectedPlate}`,
        },
        data: {
          type: "charger_alert",
          plate: detectedPlate,
          ownerId: ownerId,
          chargerId: data.chargerId || "unknown",
          location: data.location || "",
          confidence: confidence.toString(),
          click_action: "FLUTTER_NOTIFICATION_CLICK" 
        },
        topic: "charger_alerts",
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: "charger_alerts"
          }
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              badge: 1
            }
          }
        }
      };

      await admin.messaging().send(message);
      console.log(`✅ Broadcast sent for plate ${detectedPlate}`);

      // 4. Log to alerts collection
      await db.collection("alerts").add({
        recipientId: ownerId,
        recipientPlate: detectedPlate,
        plate: detectedPlate,
        location: data.location || "Unknown",
        chargerId: data.chargerId || "unknown",
        reportedBy: data.reportedBy || "anonymous",
        imageUrl: data.imageUrl,
        publicImageUrl: imageUrl,
        confidence: confidence,
        detectionTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: "sent",
        notificationMethod: "topic",
        topic: "charger_alerts"
      });
      
      console.log("💾 Alert logged to database");
      console.log("✨ Function completed successfully");

    } catch (error) {
      console.error("❌ Function Error:", error.message);
      
      // Log detailed error for debugging
      if (error.response) {
        console.error("API Status:", error.response.status);
        console.error("API Error:", error.response.data);
      } else {
        console.error("Error Stack:", error.stack);
      }
      
      // Log failed detection
      await db.collection("failedDetections").add({
        imageUrl: data.imageUrl,
        chargerId: data.chargerId,
        location: data.location,
        error: error.message,
        errorDetails: error.response?.data || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
);

/**
 * CALLABLE FUNCTION: Securely subscribe/unsubscribe users to the topic.
 */
exports.manageChargerSubscription = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in to change settings.");
    }

    const { token, action } = request.data;
    
    if (!token || !action) {
      throw new HttpsError("invalid-argument", "Missing token or action");
    }

    const topic = "charger_alerts";

    try {
      if (action === "subscribe") {
        await admin.messaging().subscribeToTopic(token, topic);
        
        // Log subscription
        await db.collection("subscriptions").doc(request.auth.uid).set({
          userId: request.auth.uid,
          topic: topic,
          token: token,
          subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
          active: true
        }, { merge: true });
        
        console.log(`✅ User ${request.auth.uid} subscribed to ${topic}`);
        return { 
          status: "success", 
          message: "Subscribed to charger alerts",
          topic: topic
        };
        
      } else if (action === "unsubscribe") {
        await admin.messaging().unsubscribeFromTopic(token, topic);
        
        // Update subscription status
        await db.collection("subscriptions").doc(request.auth.uid).update({
          active: false,
          unsubscribedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ User ${request.auth.uid} unsubscribed from ${topic}`);
        return { 
          status: "success", 
          message: "Unsubscribed from alerts",
          topic: topic
        };
        
      } else {
        throw new HttpsError("invalid-argument", "Action must be 'subscribe' or 'unsubscribe'");
      }
    } catch (error) {
      console.error("❌ Subscription error:", error);
      throw new HttpsError("internal", error.message);
    }
  }
);