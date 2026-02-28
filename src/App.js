// src/App.js
import { useEffect, useState } from "react";
import { auth, db, storage, getWebMessaging } from "./firebase";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import {
  collection,
  addDoc,
  setDoc,
  doc,
  serverTimestamp,
  onSnapshot
} from "firebase/firestore";

import { getToken } from "firebase/messaging";

import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { ref, uploadBytes } from "firebase/storage";

function normalizePlate(p) {
  return (p || "").toUpperCase().replace(/\s+/g, "");
}

function App() {
  // -------------------- State --------------------
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [plate, setPlate] = useState("");
  const [chargersList, setChargersList] = useState([]);

  // -------------------- Track Login --------------------
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // -------------------- Real-time Chargers --------------------
  useEffect(() => {
    if (!user) return;

    const chargersRef = collection(db, "chargers");
    const unsubscribe = onSnapshot(chargersRef, (snapshot) => {
      const chargers = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setChargersList(chargers);
    });

    return () => unsubscribe();
  }, [user]);

  // -------------------- Web Push Token (Browser only) --------------------
  useEffect(() => {
    if (!user) return;

    const setupWebPush = async () => {
      try {
        const messaging = await getWebMessaging();
        if (!messaging) {
          console.log(
            "Web push not supported in this environment (expected on Android WebView)."
          );
          return;
        }

        const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;
        if (!vapidKey) {
          console.warn(
            "Missing REACT_APP_FIREBASE_VAPID_KEY in your .env (web push won't work)."
          );
          return;
        }

        const token = await getToken(messaging, { vapidKey });

        if (!token) {
          console.warn("No FCM token returned (user may have blocked notifications).");
          return;
        }

        console.log("Web FCM Token:", token);

        await setDoc(
          doc(db, "userTokens", user.uid),
          { web: { token, updatedAt: serverTimestamp() } },
          { merge: true }
        );
      } catch (error) {
        console.error("Web push setup failed:", error);
      }
    };

    setupWebPush();
  }, [user]);

  // -------------------- Authentication --------------------
  const register = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      alert("User registered successfully!");
    } catch (error) {
      alert(error.message);
    }
  };

  const login = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      alert("Login successful!");
    } catch (error) {
      alert(error.message);
    }
  };

  const logout = async () => {
    await signOut(auth);
    alert("Logged out!");
  };

  // -------------------- Firestore Actions --------------------
  const savePlate = async () => {
    if (!user) return;

    const normalized = normalizePlate(plate);
    if (!normalized) {
      alert("Please enter a license plate.");
      return;
    }

    try {
      await setDoc(
        doc(db, "userPlates", user.uid),
        {
          userId: user.uid,
          plate: normalized,
        },
        { merge: true }
      );

      alert("License plate saved!");
    } catch (error) {
      alert(error.message);
    }
  };

  const occupyCharger = async (chargerId) => {
    if (!user) return;

    const normalized = normalizePlate(plate);
    if (!normalized) {
      alert("Enter your plate first (saved or typed).");
      return;
    }

    try {
      await addDoc(collection(db, "chargerUsage"), {
        chargerId,
        plate: normalized,
        userId: user.uid,
        status: "occupied",
        createdAt: serverTimestamp(),
      });

      alert("Marked charger as occupied!");
    } catch (error) {
      alert(error.message);
    }
  };

  // -------------------- Photo Helpers --------------------
  async function blobFromDataUrl(dataUrl) {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  async function uploadToStorageAndGetGsUrl(blob, uid) {
    const bucket = storage.app.options.storageBucket;
    const filename = `chargerUploads/${uid}/${Date.now()}.jpg`;
    const r = ref(storage, filename);

    await uploadBytes(r, blob, { contentType: blob.type || "image/jpeg" });

    // Your Cloud Function already converts gs:// to public https://
    return `gs://${bucket}/${filename}`;
  }

  async function createChargerUsageWithImage({ chargerId, imageUrl }) {
    if (!user) return;

    const normalized = normalizePlate(plate);
    if (!normalized) {
      alert("Enter your plate first (saved or typed).");
      return;
    }

    await addDoc(collection(db, "chargerUsage"), {
      chargerId,
      plate: normalized,
      userId: user.uid,
      status: "occupied",
      imageUrl,
      createdAt: serverTimestamp(),
    });
  }

  const takePhotoForCharger = async (chargerId) => {
    try {
      if (!user) return;

      const photo = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      });

      const blob = await blobFromDataUrl(photo.dataUrl);
      const gsUrl = await uploadToStorageAndGetGsUrl(blob, user.uid);

      await createChargerUsageWithImage({ chargerId, imageUrl: gsUrl });
      alert("Photo uploaded and report created!");
    } catch (e) {
      console.error(e);
      alert("Photo capture failed (did you deny camera permission?).");
    }
  };

  const uploadFileForCharger = async (chargerId, file) => {
    try {
      if (!user) return;
      if (!file) return;

      if (!file.type?.startsWith("image/")) {
        alert("Please choose an image.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert("Image too large. Please use one under 8MB.");
        return;
      }

      const gsUrl = await uploadToStorageAndGetGsUrl(file, user.uid);
      await createChargerUsageWithImage({ chargerId, imageUrl: gsUrl });
      alert("Image uploaded and report created!");
    } catch (e) {
      console.error(e);
      alert("Upload failed.");
    }
  };

  // -------------------- JSX Rendering --------------------
  if (user) {
    return (
      <div style={{ padding: 40 }}>
        <h2>Welcome, {user.email}</h2>

        <h3>Register your car plate:</h3>
        <input
          type="text"
          placeholder="Your car plate"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
        />
        <button onClick={savePlate} style={{ marginLeft: 10 }}>
          Save Plate
        </button>

        <h3>Available Chargers:</h3>

        {chargersList.map((charger) => (
          <div key={charger.id} style={{ marginBottom: 10 }}>
            <strong>{charger.name}</strong> ({charger.location}) - Capacity:{" "}
            {charger.capacity}

            <button
              onClick={() => occupyCharger(charger.id)}
              style={{ marginLeft: 10 }}
            >
              Park Here
            </button>

            <button
              onClick={() => takePhotoForCharger(charger.id)}
              style={{ marginLeft: 10 }}
            >
              Take Photo
            </button>

            <label style={{ marginLeft: 10, cursor: "pointer" }}>
              Upload
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // allow selecting same file again
                  uploadFileForCharger(charger.id, file);
                }}
              />
            </label>
          </div>
        ))}

        <br />
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>EV Alert - Register / Login</h2>

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <br />
      <br />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <br />
      <br />

      <button onClick={register}>Register</button>
      <button onClick={login} style={{ marginLeft: 10 }}>
        Login
      </button>
    </div>
  );
}

export default App;