import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { UploadCloud, Save, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react';

// --- Firebase Config ---
// This configuration is from your original code.
const firebaseConfig = {
    apiKey: "AIzaSyCeafx8n1lOqyPINvQH5vDt1vD9Oh7diOU",
    authDomain: "souma-s.firebaseapp.com",
    projectId: "souma-s",
    storageBucket: "souma-s.firebasestorage.app",
    messagingSenderId: "1070150131413",
    appId: "1:1070150131413:web:181a6e440c6e0280988c5c"
};

// --- Main App Component ---

export default function App() {
    // --- Your existing state and refs ---
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
    const [editingItemId, setEditingItemId] = useState(null);

    // --- Your existing functions ---
    const handleDelete = async (id) => {
        if (!db || !userId) return;
        try {
            await deleteDoc(doc(db, `detections/${userId}/items`, id));
        } catch (err) {
            console.error("Delete error:", err);
        }
    };

    const toBase64 = (file) => new Promise((res, rej) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
    });

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
        
        // Use the provided Gemini API Key
        const apiKey = "AIzaSyD1A9Fl8NXyR2ylleYhlJfWoKvq4kNs4FY";

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

On a stucco band:
Text: "..."
Translation: "..."

On a manuscript margin:
Margin text: "..."
Translation: "..."

Or, if only one block:
Text: "..."
Translation: "..."
`;
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: "user",
                            parts: [
                                { text: prompt },
                                { inlineData: { mimeType: imageFile.type, data: base64 } }
                            ]
                        }]
                    })
                }
            );

            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(errorBody.error.message || `API request failed with status ${response.status}`);
            }

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

    // --- Your existing useEffect hooks ---
    useEffect(() => {
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);
        setDb(firestoreDb);

        const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
            if (user) {
                setUserId(user.uid);
                setIsAuthReady(true);
                const adminDoc = await getDoc(doc(firestoreDb, 'admin_users', user.uid));
                setIsAdmin(adminDoc.exists());
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

            const initialCorrections = {};
            historyData.forEach(item => {
                initialCorrections[item.id] = item.correctedText || item.text;
            });
            setCorrections(initialCorrections);
        });
        return () => unsubscribe();
    }, [isAuthReady, db, userId]);
    
    useEffect(() => {
        const fontUrls = [
            'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap',
            'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&display=swap',
            'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'
        ];
        fontUrls.forEach(url => {
            const link = document.createElement('link');
            link.href = url;
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        });
    }, []);

    return (
        <>
            <style>{`
              :root {
                --color-black-900: #111111;
                --color-black-800: #1C1C1C;
                --color-gold-500: #D4AF37;
                --color-gold-600: #C09E32;
                --color-cream-100: #F5F5DC;
                --color-red-500: #ef4444;
                --color-red-600: #dc2626;
              }

              body {
                background-color: var(--color-black-900) !important;
                color: var(--color-cream-100);
                font-family: 'Inter', sans-serif;
                margin: 0;
              }
              
              .app-wrapper {
                min-height: 100vh;
                width: 100%;
                background-color: var(--color-black-900);
              }

              .styled-header {
                width: 100%;
                padding: 1.5rem;
                background-color: rgba(17, 17, 17, 0.5);
                backdrop-filter: blur(4px);
                border-bottom: 1px solid rgba(212, 175, 55, 0.2);
                position: sticky;
                top: 0;
                z-index: 50;
                text-align: center;
                box-sizing: border-box;
              }
              .styled-header h1 {
                font-family: 'Cinzel Decorative', cursive;
                color: var(--color-gold-500);
                font-weight: 700;
                letter-spacing: 0.1em;
                font-size: 2.25rem;
                margin: 0;
              }
              .styled-header p {
                color: var(--color-cream-100);
                margin-top: 0.5rem;
                font-family: 'Inter', sans-serif;
                font-size: 0.875rem;
              }
              @media (min-width: 768px) {
                .styled-header h1 { font-size: 3rem; }
                .styled-header p { font-size: 1rem; }
              }

              .main-content {
                display: grid;
                gap: 2rem;
                padding: 1rem;
              }
              @media (min-width: 768px) { .main-content { padding: 2rem; } }
              @media (min-width: 1024px) { .main-content { grid-template-columns: repeat(12, minmax(0, 1fr)); } }
              
              .left-panel {
                display: flex;
                flex-direction: column;
                gap: 2rem;
              }
              @media (min-width: 1024px) { .left-panel { grid-column: span 5 / span 5; } }

              .right-panel {
                display: flex;
                flex-direction: column;
                gap: 2rem;
              }
              @media (min-width: 1024px) { .right-panel { grid-column: span 7 / span 7; } }
              
              .panel {
                width: 100%;
                height: 100%;
                padding: 1rem;
                background-color: rgba(28, 28, 28, 0.5);
                border-radius: 1rem;
                border: 1px solid rgba(212, 175, 55, 0.3);
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                box-sizing: border-box;
              }
              @media (min-width: 768px) { .panel { padding: 2rem; } }

              .section-title {
                text-align: center;
                margin: 1rem 0;
              }
              .section-title h2 {
                font-family: 'Cinzel Decorative', cursive;
                color: var(--color-gold-500);
                letter-spacing: 0.05em;
                font-size: 1.875rem;
                margin: 0;
              }
              .section-title .divider {
                width: 6rem;
                height: 1px;
                margin: 0.5rem auto 0 auto;
                background-color: rgba(212, 175, 55, 0.5);
              }

              .upload-label {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                width: 100%;
                padding: 2rem;
                margin-top: 1rem;
                border: 2px dashed rgba(212, 175, 55, 0.4);
                border-radius: 0.75rem;
                transition: all 0.3s ease;
                cursor: pointer;
                box-sizing: border-box;
              }
              .upload-label:hover { border-color: var(--color-gold-500); }
              .upload-label .placeholder-text { text-align: center; color: rgba(245, 245, 220, 0.7); }
              .upload-label .placeholder-text span { font-weight: 700; color: var(--color-gold-500); }
              .upload-label img { max-height: 16rem; width: auto; border-radius: 0.5rem; }

              .result-display {
                background-color: rgba(17, 17, 17, 0.5);
                padding: 1rem;
                border-radius: 0.5rem;
                margin-top: 1rem;
                min-height: 100px;
                white-space: pre-wrap;
                font-family: 'Noto Naskh Arabic', serif;
                font-size: 1.125rem;
                color: var(--color-cream-100);
              }
              .result-display p { margin: 0; font-family: 'Inter', sans-serif; }
              .result-display .analyzing { text-align: center; color: var(--color-gold-500); }
              .result-display .error { color: var(--color-red-500); }
              .result-display .placeholder { color: rgba(245, 245, 220, 0.5); }

              .history-container {
                margin-top: 1rem;
                max-height: 80vh;
                overflow-y: auto;
                padding-right: 0.5rem;
                display: flex;
                flex-direction: column;
                gap: 1rem;
              }

              .history-item-card {
                background-color: rgba(28, 28, 28, 0.4);
                padding: 1rem;
                border-radius: 0.75rem;
                border: 1px solid rgba(212, 175, 55, 0.2);
              }
              .history-item-card .info-header { display: flex; justify-content: space-between; align-items: flex-start; }
              .history-item-card .info-text .name { font-weight: 700; color: var(--color-cream-100); font-family: 'Inter', sans-serif; }
              .history-item-card .info-text .date { font-size: 0.75rem; color: rgba(212, 175, 55, 0.7); font-family: 'Inter', sans-serif; }
              .history-item-card .actions { display: flex; align-items: center; gap: 0.5rem; }
              .history-item-card .actions button { background: none; border: none; padding: 0.5rem; cursor: pointer; transition: color 0.3s ease; }
              .history-item-card .actions .toggle-btn { color: var(--color-gold-500); }
              .history-item-card .actions .toggle-btn:hover { color: var(--color-gold-600); }
              .history-item-card .actions .delete-btn { color: var(--color-red-500); }
              .history-item-card .actions .delete-btn:hover { color: var(--color-red-600); }
              .history-item-card .transcription-text { color: var(--color-cream-100); white-space: pre-wrap; margin-top: 0.5rem; font-family: 'Noto Naskh Arabic', serif; font-size: 1.25rem; }

              .correction-wrapper {
                margin-top: 1rem;
                padding: 1rem;
                background-color: rgba(17, 17, 17, 0.5);
                border-radius: 0.375rem;
              }
              .correction-wrapper label { display: block; font-size: 0.875rem; font-weight: 700; color: var(--color-gold-500); margin-bottom: 0.5rem; font-family: 'Inter', sans-serif; }
              .correction-wrapper textarea {
                width: 100%;
                padding: 0.5rem;
                background-color: var(--color-black-800);
                color: var(--color-cream-100);
                border-radius: 0.375rem;
                border: 1px solid rgba(212, 175, 55, 0.3);
                font-family: 'Noto Naskh Arabic', serif;
                font-size: 1.125rem;
                box-sizing: border-box;
                resize: vertical;
              }
              .correction-wrapper textarea:focus { outline: none; border-color: var(--color-gold-500); box-shadow: 0 0 0 1px var(--color-gold-500); }
              .correction-wrapper .save-button-container { text-align: right; margin-top: 0.5rem; }

              .styled-button {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
                padding: 0.75rem 1.5rem;
                font-weight: 700;
                color: var(--color-black-900);
                background-color: var(--color-gold-500);
                border-radius: 0.5rem;
                border: none;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                transition: all 0.3s ease;
                cursor: pointer;
              }
              .styled-button:hover { background-color: var(--color-gold-600); box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
              .styled-button:focus { outline: none; box-shadow: 0 0 0 3px var(--color-black-900), 0 0 0 5px var(--color-gold-500); }
              .styled-button:disabled { background-color: rgba(212, 175, 55, 0.5); cursor: not-allowed; box-shadow: none; }
              .styled-button.save-correction { padding: 0.5rem 1rem; font-size: 0.875rem; }
            `}</style>
            <div className="app-wrapper">
                <header className="styled-header">
                    <h1>Historical Arabic Transcription</h1>
                    <p>Detect and translate text from historical artifacts</p>
                </header>

                <main className="main-content">
                    <div className="left-panel">
                        <div className="panel">
                            <div className="section-title">
                                <h2>Upload Artifact Image</h2>
                                <div className="divider" />
                            </div>
                            <label htmlFor="file-upload" className="upload-label">
                                {previewUrl ? <img src={previewUrl} alt="Preview" /> :
                                    <div className="placeholder-text">
                                        <UploadCloud size={64} style={{ margin: '0 auto 1rem auto' }} />
                                        <span>Click to upload</span> or drag & drop
                                    </div>}
                            </label>
                            <input id="file-upload" type="file" style={{ display: 'none' }} onChange={handleImageChange} accept="image/png, image/jpeg, image/webp" />
                            
                            {imageFile && (
                                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                                     <p style={{ fontFamily: "'Inter', sans-serif", marginBottom: '1rem' }}>Selected: <span style={{ fontWeight: 700, color: 'var(--color-gold-500)' }}>{imageFile.name}</span></p>
                                    <button className="styled-button" onClick={handleDetectText} disabled={isLoading}>
                                        {isLoading ? <Loader2 className="animate-spin" /> : "Detect Arabic Text"}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="panel">
                             <div className="section-title">
                                <h2>Transcription Result</h2>
                                <div className="divider" />
                             </div>
                             <div className="result-display">
                                {isLoading ? <p className="analyzing">Analyzing...</p> : 
                                 error ? <p className="error">{error}</p> : 
                                 detectedText || <p className="placeholder">Detected text will appear here.</p>}
                             </div>
                        </div>
                    </div>

                    <div className="right-panel">
                        <div className="panel">
                            <div className="section-title">
                                <h2>Detection History</h2>
                                <div className="divider" />
                            </div>
                            <div className="history-container">
                                {isAuthReady && history.length > 0 ? history.map(item => (
                                    <div key={item.id} className="history-item-card">
                                        <div className="info-header">
                                            <div className="info-text">
                                                <p className="name">{item.imageName}</p>
                                                <p className="date">{item.timestamp.toLocaleDateString()}</p>
                                            </div>
                                            {isAdmin && (
                                                <div className="actions">
                                                     <button className="toggle-btn" onClick={() => setEditingItemId(editingItemId === item.id ? null : item.id)}>
                                                        {editingItemId === item.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                                    </button>
                                                    <button className="delete-btn" onClick={() => handleDelete(item.id)}>
                                                        <Trash2 size={20} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <p className="transcription-text">{item.correctedText || item.text}</p>
                                        
                                        {isAdmin && editingItemId === item.id && (
                                            <div className="correction-wrapper">
                                                <label>Corrected Text</label>
                                                <textarea
                                                    value={corrections[item.id] || ''}
                                                    onChange={e => setCorrections(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                    rows="4"
                                                />
                                                <div className="save-button-container">
                                                    <button 
                                                        className="styled-button save-correction"
                                                        onClick={async () => {
                                                            await updateDoc(doc(db, `detections/${userId}/items`, item.id), {
                                                                correctedText: corrections[item.id],
                                                                isCorrected: true,
                                                                correctedAt: serverTimestamp()
                                                            });
                                                            setSavedStates(prev => ({ ...prev, [item.id]: true }));
                                                            setTimeout(() => setSavedStates(prev => ({ ...prev, [item.id]: false })), 2000);
                                                            setEditingItemId(null);
                                                        }}
                                                        disabled={savedStates[item.id]}
                                                    >
                                                        <Save size={16} />
                                                        {savedStates[item.id] ? 'Saved!' : 'Save Correction'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )) : <p style={{color: 'rgba(245, 245, 220, 0.5)', textAlign: 'center', padding: '2rem 0'}}>No history yet.</p>}
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </>
    );
}
