# Aris 🖐️✨

> Exploring the Future of Human-Computer Interaction & Touchless DJing

Aris is a real-time, browser-based **Hand-Tracking Anti-Gravity & DJ Controller**. Using **MediaPipe Hand Landmarker** and **TensorFlow.js**, it allows users to interact with digital particles and control complex audio effect chains using simple, low-latency hand gestures—no mouse, keyboard, or physical controller required.

---

## 🌌 Modes of Operation

### 1. Anti-Gravity Mode (Particle Controller)
Control a simulated particle field using the "Force" of your hands.
* **Repel/Attract Particles:** Move your hands to push or pull particles.
* **Speed/Gravity Control:** Adjust physics dynamics on the fly using intuitive gestures.
* **Color Palettes:** Dynamically switch particle themes (Galaxy, Nebula, etc.).

### 2. DJ Mode (Gesture-Controlled Audio Effects)
Upload your favorite audio track and master it in real-time with your hands.
* **✋ Open Hand:** **Filter Sweep** (X-axis = Cutoff Frequency, Y-axis = Resonance).
* **✊ Fist:** **Bass Boost & Distortion** (X-axis = Distortion amount, Y-axis = Bass boost level).
* **🤏 Pinch:** **Volume & Pan** (X-axis = Stereo panning, Y-axis = Volume level).
* **✌️ Victory:** **Delay / Echo** (X-axis = Delay time, Y-axis = Feedback amount).
* **👆 Pointing:** **Stutter / Beat Repeat** (X-axis = Stutter rate, Y-axis = Wet/Dry mix).
* **🖐️ Finger Spread:** Directly controls **Effect Intensity** (0% = dry signal, 100% = max effect).

---

## 🚀 Key Features

* **Real-time 21-Point Hand Detection:** Accurate tracking powered by Google's MediaPipe.
* **Low-Latency Signal Processing:** Built on the Web Audio API for seamless transition of audio effects.
* **Browser-Based Execution:** Runs entirely client-side with zero installation or setup.
* **Responsive Visualizers:** Gorgeous canvas-based oscilloscope, frequency spectrum, and gesture overlays.

---

## 🛠️ Technology Stack

* **Core:** HTML5, Modern ES6+ JavaScript, CSS3 (Vanilla Custom Properties).
* **Tracking:** MediaPipe Hands, TensorFlow.js.
* **Audio:** Web Audio API (Filter, WaveShaper, Delay, Reverb, DynamicsCompressor, Analyser).
* **Visuals:** Canvas 2D API (Dynamic Particles & Spectrograms).

---

## 💻 Getting Started

Since Aris runs entirely in the browser, you can launch it using any simple local HTTP server:

```bash
# Clone the repository
git clone https://github.com/lutherbanze/Aris.git
cd Aris

# Start a local server (e.g., using Python)
python3 -m http.server 8080
```

Open `http://localhost:8080` in your browser (Chrome/Edge/Safari with webcam permissions enabled) and start interacting!

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
