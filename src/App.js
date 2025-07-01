import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Upload, FileScan, History, Loader2, AlertTriangle, Image as ImageIcon } from 'lucide-react';

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyCeafx8n1lOqyPINvQH5vDt1vD9Oh7diOU",
  authDomain: "souma-s.firebaseapp.com",
  projectId: "souma-s",
  storageBucket: "souma-s.firebasestorage.app",
  messagingSenderId: "1070150131413",
  appId: "1:1070150131413:web:181a6e440c6e0280988c5c"
};

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [detectedText, setDetectedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [corrections, setCorrections] = useState({});
  const [savedStates, setSavedStates] = useState({});
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const hasAttemptedAuthRef = useRef(false);

  // 🗑️ Delete function
  const handleDelete = async (id) => {
    if (!db || !userId) return;
    try {
      await deleteDoc(doc(db, `detections/${userId}/items`, id));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  // Firebase init + auth
  useEffect(() => {
    const app = initializeApp(firebaseConfig);
    const firestoreDb = getFirestore(app);
    const firebaseAuth = getAuth(app);
    setDb(firestoreDb);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        setUserId(user.uid);
        window.currentUserId = user.uid;
        setIsAuthReady(true);
        const adminDoc = await getDoc(doc(firestoreDb, 'admin_users', user.uid));
        setIsAdmin(adminDoc.exists());
        window.isAdmin = adminDoc.exists();
        console.log("Am I admin?", adminDoc.exists());
      } else if (!hasAttemptedAuthRef.current) {
        hasAttemptedAuthRef.current = true;
        try {
          await signInAnonymously(firebaseAuth);
        } catch (authError) {
          console.error("Anonymous sign-in error:", authError);
        }
        setIsAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore listener
  useEffect(() => {
    if (!isAuthReady || !db || !userId) return;

    const q = query(collection(db, `detections/${userId}/items`));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const historyData = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const timestamp = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
        historyData.push({ id: doc.id, ...data, timestamp });
      });
      historyData.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(historyData);

      const initial = {};
      historyData.forEach(item => {
        initial[item.id] = item.correctedText || item.text;
      });
      setCorrections(initial);
    });
    return () => unsubscribe();
  }, [isAuthReady, db, userId]);

  // Helpers
  const toBase64 = (file) => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => res(reader.result.split(',')[1]);
    reader.onerror = rej;
  });

  // Events
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setDetectedText('');
      setError('');
    }
  };

  const handleDetectText = async () => {
    if (!imageFile) return setError('Please upload an image first.');
    setIsLoading(true);
    setError('');
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    try {
      const base64 = await toBase64(imageFile);
      const prompt = `
You are a world-class expert in historical Arabic epigraphy and paleography.
Your task is to meticulously analyze the provided image of a historical object (coin, manuscript, stucco, tile, etc.) and transcribe ONLY the Arabic script visible.

- If the text is clearly organized into fields (e.g., outer ring, central field, margin), transcribe them separately.
- If parts of the text are illegible, use [...] to indicate missing sections.
- After transcription, provide a concise English translation for each field.
- Do NOT add historical commentary, calligraphy style, artistic analysis, or speculative guesses about the object.
- If no Arabic text is discernible, respond with: "No clear Arabic text detected."

✅ Output format:
On coins (for example):
Outer ring: "..."
Central field: "..."
Translation:
Outer ring: "..."
Central field: "..."

Or, if only one block:
Text: "..."
Translation: "..."

On a stucco band:
Text: "..."
Translation: "..."

On a manuscript margin:
Margin text: "..."
Translation: "..."`;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: imageFile.type, data: base64 } }] }]
          })
        }
      );
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "No text detected.";
      setDetectedText(text);

      if (db && userId) {
        await addDoc(collection(db, `detections/${userId}/items`), {
          text,
          imageName: imageFile.name,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error(err);
      setError("Error: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // UI
  return (
    <>
      <h1 className="text-red-500 text-3xl">Tailwind works!</h1>
      <div className="bg-gray-900 text-gray-100 min-h-screen p-4">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-teal-400">Historical Arabic Text Detector</h1>
          <p className="text-lg text-gray-400">
            Upload an image of a historical artifact to extract Arabic script.
          </p>
        </header>

        <main className="grid lg:grid-cols-12 gap-8">
          {/* Upload panel */}
          <div className="lg:col-span-5 bg-gray-800/50 p-6 rounded-2xl">
            <h2 className="text-2xl font-semibold text-teal-300 mb-4 flex items-center">
              <Upload className="mr-3" />1. Upload Image
            </h2>
            <label
              htmlFor="file-upload"
              className="border-2 border-dashed border-gray-600 rounded-xl p-6 cursor-pointer hover:border-teal-500"
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="max-h-64 w-auto" />
              ) : (
                <div className="text-gray-400 text-center">
                  <ImageIcon className="mx-auto h-12 w-12" />
                  <span>Click to upload or drag & drop</span>
                </div>
              )}
            </label>
            <input id="file-upload" type="file" className="hidden" onChange={handleImageChange} />
            <button
              onClick={handleDetectText}
              disabled={!imageFile || isLoading}
              className="mt-4 bg-teal-600 w-full py-2 rounded"
            >
              {isLoading ? <Loader2 className="animate-spin mx-auto" /> : "Detect Arabic Text"}
            </button>
          </div>

          {/* Results & History */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <div className="bg-gray-800/50 p-6 rounded-2xl">
              <h2 className="text-2xl font-semibold text-teal-300 mb-4">2. Transcription Results</h2>
              <div className="bg-gray-900 p-4 rounded">
                {error ? (
                  <p className="text-red-400">{error}</p>
                ) : (
                  detectedText || <p className="text-gray-500">Detected text will appear here.</p>
                )}
              </div>
            </div>

            <div className="bg-gray-800/50 p-6 rounded-2xl">
              <h2 className="text-2xl font-semibold text-teal-300 mb-4 flex items-center">
                <History className="mr-3" />Detection History
              </h2>
              <div className="space-y-3">
                {isAuthReady && history.length > 0 ? (
                  history.map(item => (
                    <div key={item.id} className="bg-gray-700/50 p-3 rounded-lg">
                      <p className="text-xs text-gray-400">
                        {item.imageName} - {item.timestamp.toLocaleDateString()}
                      </p>
                      <p className="text-gray-200 whitespace-pre-wrap">
                        {item.correctedText || item.text}
                      </p>
                      {isAdmin && (
                        <div className="mt-2 flex flex-col">
                          <textarea
                            className="w-full p-2 rounded text-black"
                            value={corrections[item.id] || ''}
                            onChange={e =>
                              setCorrections(prev => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                          <div className="flex gap-2 mt-1">
                            <button
                              onClick={async () => {
                                await updateDoc(doc(db, `detections/${userId}/items`, item.id), {
                                  correctedText: corrections[item.id],
                                  isCorrected: true,
                                  correctedAt: serverTimestamp()
                                });
                                setSavedStates(prev => ({ ...prev, [item.id]: true }));
                              }}
                              disabled={savedStates[item.id]}
                              className="px-3 py-1 bg-blue-600 text-white rounded"
                            >
                              {savedStates[item.id] ? '✓ Saved' : 'Save Correction'}
                            </button>

                            <button
                              onClick={() => handleDelete(item.id)}
                              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500">No history yet.</p>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
