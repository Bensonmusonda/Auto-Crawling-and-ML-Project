# Frontend Module

A modern, React-based dashboard designed for managing the end-to-end data lifecycle. Built with Vite and prioritized for visual excellence, it provides a premium interface for data scientists and developers.

## Dashboard Sections

### 1. Dataset Explorer
Browse through all scraped and uploaded datasets. The explorer allows for live previews, metadata inspection, and CSV export functionality.

### 2. Data Processing
Configure complex processing pipelines using a visual interface. Chain operations like normalization, encoding, and feature engineering to prepare your data for training.

### 3. ML Training
Monitor model training progress in real-time. This section includes visualizations for loss/accuracy curves and final model evaluation metrics.

## Technical Stack

- **Framework**: React (Vite)
- **State Management**: React Hooks & Context API
- **Styling**: Vanilla CSS (Premium Monochrome Theme)
- **Communication**: REST API and WebSockets for real-time data

## Getting Started

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

The application will be accessible at http://localhost:3000.

## Environment Configuration

Ensure the `VITE_API_URL` environment variable points to your running backend instance (default: `http://localhost:8000`).
