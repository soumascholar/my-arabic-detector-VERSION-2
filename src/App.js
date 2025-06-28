import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { Upload, FileScan, History, Loader2, AlertTriangle, Image as ImageIcon } from 'lucide-react';

// --- Firebase Configuration ---
// This should be YOUR REAL config that you got from the Firebase Console.
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
    // --- State Management ---
    const [imageFile, setImageFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [detectedText, setDetectedText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [history, setHistory] = useState([]);
    
    // Firebase state
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    // A one-time variable to prevent multiple anonymous sign-ins
    let hasAttemptedAuth = false;

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else if (!hasAttemptedAuth) {
                    hasAttemptedAuth = true;
                    try {
                        // In a local environment, initialAuthToken is unlikely to exist.
                        // We will default to anonymous sign-in.
                        await signInAnonymously(firebaseAuth);
                    } catch (authError) {
                        console.error("Anonymous sign-in error:", authError);
                        setError("Could not authenticate. History may not be saved.");
                    }
                    // We still set auth as ready to allow the app to function.
                    setIsAuthReady(true);
                }
            });
            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase initialization failed:", e);
            setError("Could not connect to the database. History is disabled.");
            setIsAuthReady(true); // Allow app to run without DB
        }
    }, []);

    // --- Firestore History Listener ---
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        // Note: You need to define security rules in your Firebase project
        // to allow this read/write operation.
        const historyCollectionPath = `detections/${userId}/items`;
        const q = query(collection(db, historyCollectionPath));
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const historyData = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const timestamp = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
                historyData.push({ id: doc.id, ...data, timestamp });
            });
            historyData.sort((a, b) => b.timestamp - a.timestamp);
            setHistory(historyData);
        }, (err) => {
            console.error("Error fetching history:", err);
            setError("Could not load detection history. Check Firestore security rules.");
        });

        return () => unsubscribe();
    }, [isAuthReady, db, userId]);


    // --- Helper Functions ---
    const toBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = (error) => reject(error);
    });

    // --- Event Handlers ---
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
        if (!imageFile) {
            setError('Please upload an image first.');
            return;
        }
        
        // IMPORTANT: Get the API Key from environment variables
        const apiKey = process.env.REACT_APP_GEMINI_API_KEY;

        if (!apiKey) {
            setError("Gemini API key is not configured. Please set it in your .env file.");
            return;
        }

        setIsLoading(true);
        setError('');
        setDetectedText('');

        try {
            const base64ImageData = await toBase64(imageFile);
            
            const prompt = `You are a world-class expert in historical Arabic epigraphy and paleography. Your task is to meticulously analyze the provided image of a historical object (stucco, coin, manuscript, tile, etc.) and transcribe ONLY the Arabic script visible.
            - Provide a clear transcription of the Arabic text.
            - If parts of the text are illegible, use [...] to indicate the missing or unreadable section.
            - Do not describe the object itself or provide historical context unless it is part of the script.
            - If no Arabic text is discernible in the image, respond with "No clear Arabic text detected.".`;

            const payload = {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: imageFile.type,
                                    data: base64ImageData,
                                }
                            }
                        ]
                    }
                ],
            };
            
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                 const errorBody = await response.text();
                throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
            }

            const result = await response.json();
            
            let transcription = "Could not extract text. The model's response was empty.";
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
              transcription = result.candidates[0].content.parts[0].text;
            } else if (result.promptFeedback && result.promptFeedback.blockReason) {
                transcription = `Detection blocked. Reason: ${result.promptFeedback.blockReason}`;
            }

            setDetectedText(transcription);

            if (db && userId) {
                 const historyCollectionPath = `detections/${userId}/items`;
                await addDoc(collection(db, historyCollectionPath), {
                    text: transcription,
                    imageName: imageFile.name,
                    createdAt: serverTimestamp(),
                });
            }

        } catch (err) {
            console.error("Detection error:", err);
            setError(`An error occurred during detection: ${err.message}. Please try again.`);
            setDetectedText('');
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- UI Rendering ---
    return (
        <div className="bg-gray-900 text-gray-100 min-h-screen font-sans flex flex-col p-4 md:p-6 lg:p-8">
            <header className="text-center mb-8">
                <h1 className="text-4xl md:text-5xl font-bold text-teal-400">
                    Historical Arabic Text Detector
                </h1>
                <p className="text-lg text-gray-400 mt-2">
                    Upload an image of a historical artifact to extract Arabic script.
                </p>
            </header>

            <main className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* --- Left Panel: Uploader and Preview --- */}
                <div className="lg:col-span-5 flex flex-col bg-gray-800/50 p-6 rounded-2xl shadow-lg border border-gray-700">
                    <h2 className="text-2xl font-semibold text-teal-300 mb-4 flex items-center">
                        <Upload className="mr-3" />
                        1. Upload Image
                    </h2>
                    <div className="flex-grow flex flex-col">
                        <label htmlFor="file-upload" className="flex-grow flex flex-col justify-center items-center w-full border-2 border-dashed border-gray-600 rounded-xl p-6 cursor-pointer hover:border-teal-500 hover:bg-gray-800 transition-colors duration-300">
                            {previewUrl ? (
                                <img src={previewUrl} alt="Preview" className="max-h-64 w-auto object-contain rounded-lg shadow-md" />
                            ) : (
                                <div className="text-center text-gray-400">
                                    <ImageIcon className="mx-auto h-12 w-12" />
                                    <span className="mt-2 block font-semibold">Click to upload or drag & drop</span>
                                    <span className="mt-1 block text-sm">PNG, JPG, WEBP</span>
                                </div>
                            )}
                        </label>
                        <input id="file-upload" type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleImageChange} />
                    </div>
                    <button
                        onClick={handleDetectText}
                        disabled={!imageFile || isLoading}
                        className="mt-6 w-full flex items-center justify-center bg-teal-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-teal-500 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed transform hover:scale-105 active:scale-100 disabled:transform-none"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="animate-spin mr-3" />
                                Detecting...
                            </>
                        ) : (
                            <>
                                <FileScan className="mr-3" />
                                Detect Arabic Text
                            </>
                        )}
                    </button>
                </div>

                {/* --- Right Panel: Results and History --- */}
                <div className="lg:col-span-7 flex flex-col gap-8">
                    {/* Results Box */}
                    <div className="bg-gray-800/50 p-6 rounded-2xl shadow-lg border border-gray-700 flex flex-col flex-1 min-h-[300px]">
                        <h2 className="text-2xl font-semibold text-teal-300 mb-4">2. Transcription Results</h2>
                        <div className="bg-gray-900 flex-grow rounded-lg p-4 text-lg whitespace-pre-wrap overflow-y-auto" style={{fontFamily: "'Noto Naskh Arabic', serif"}}>
                            {isLoading && <p className="text-gray-400">Analyzing image...</p>}
                            {error && (
                                <div className="text-red-400 flex items-center">
                                    <AlertTriangle className="mr-2 h-5 w-5" />
                                    <div>
                                       <p className="font-semibold">Error</p>
                                       <p className="text-sm">{error}</p>
                                    </div>
                                </div>
                            )}
                            {!isLoading && !error && !detectedText && <p className="text-gray-500">Detected text will appear here.</p>}
                            {detectedText}
                        </div>
                    </div>

                    {/* History Box */}
                    <div className="bg-gray-800/50 p-6 rounded-2xl shadow-lg border border-gray-700 flex flex-col flex-1 min-h-[300px]">
                        <h2 className="text-2xl font-semibold text-teal-300 mb-4 flex items-center">
                            <History className="mr-3" />
                            Detection History
                        </h2>
                        <div className="flex-grow space-y-3 pr-2 overflow-y-auto">
                            {isAuthReady && history.length > 0 ? (
                                history.map(item => (
                                    <div key={item.id} className="bg-gray-700/50 p-3 rounded-lg border-l-4 border-teal-500">
                                        <p className="font-mono text-xs text-gray-400 mb-1" title={item.timestamp.toLocaleString()}>{item.imageName || 'Untitled'} - {item.timestamp.toLocaleDateString()}</p>
                                        <p className="text-gray-200 text-sm whitespace-pre-wrap" style={{fontFamily: "'Noto Naskh Arabic', serif"}}>{item.text}</p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500 h-full flex items-center justify-center">
                                    {isAuthReady ? "No history yet. Detections will be saved here." : "Connecting to history..."}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </main>
             <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&family=Inter:wght@400;500;700&display=swap');
                body { font-family: 'Inter', sans-serif; }
            `}</style>
        </div>
    );
}
