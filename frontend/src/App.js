import React, { useState, useEffect } from 'react';
import { Upload, Play, Clock, CheckCircle, XCircle, TrendingUp, BarChart3, Database, Brain, Zap } from 'lucide-react';

const API_BASE_URL = 'http://localhost:8000';

export default function MLTrainingDashboard() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [manifest, setManifest] = useState(null);
  const [csvFiles, setCsvFiles] = useState([]);
  const [selectedCsv, setSelectedCsv] = useState('');
  const [targetColumn, setTargetColumn] = useState('');
  const [autoTune, setAutoTune] = useState(true);
  const [params, setParams] = useState({});
  const [training, setTraining] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [result, setResult] = useState(null);
  const [trainedModels, setTrainedModels] = useState([]);
  const [activeTab, setActiveTab] = useState('train');
  const [logs, setLogs] = useState([]);

  // Fetch available models on mount
  useEffect(() => {
    fetchModels();
    fetchTrainedModels();
  }, []);

  // Poll for results when training
  useEffect(() => {
    if (jobId && training) {
      const interval = setInterval(() => {
        checkJobStatus(jobId);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [jobId, training]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { message, type, timestamp: new Date().toLocaleTimeString() }]);
  };

  const fetchModels = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ml-training/models`);
      const data = await response.json();
      setModels(data.models || []);
      addLog(`Loaded ${data.models?.length || 0} available models`, 'success');
    } catch (error) {
      addLog('Failed to fetch models: ' + error.message, 'error');
    }
  };

  const fetchManifest = async (modelType) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ml-training/models/${modelType}/manifest`);
      const data = await response.json();
      setManifest(data);
      
      // Initialize params with defaults
      const defaultParams = {};
      Object.entries(data.ui_manifest).forEach(([key, config]) => {
        defaultParams[key] = config.default;
      });
      setParams(defaultParams);
      addLog(`Loaded hyperparameters for ${modelType}`, 'info');
    } catch (error) {
      addLog('Failed to fetch manifest: ' + error.message, 'error');
    }
  };

  const fetchTrainedModels = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ml-training/models/trained?limit=10`);
      const data = await response.json();
      setTrainedModels(data.models || []);
    } catch (error) {
      addLog('Failed to fetch trained models: ' + error.message, 'error');
    }
  };

  const handleModelSelect = (modelType) => {
    setSelectedModel(modelType);
    fetchManifest(modelType);
    setResult(null);
  };

  const handleTrain = async () => {
    if (!selectedModel || !selectedCsv || !targetColumn) {
      addLog('Please fill in all required fields', 'error');
      return;
    }

    setTraining(true);
    setResult(null);
    addLog(`Starting training: ${selectedModel} on ${selectedCsv}`, 'info');

    try {
      const response = await fetch(`${API_BASE_URL}/api/ml-training/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_path: selectedCsv,
          target_column: targetColumn,
          model_type: selectedModel,
          auto_tune: autoTune,
          params: autoTune ? undefined : params
        })
      });

      const data = await response.json();
      setJobId(data.job_id);
      addLog(`Training job submitted: ${data.job_id}`, 'success');
    } catch (error) {
      setTraining(false);
      addLog('Training failed: ' + error.message, 'error');
    }
  };

  const checkJobStatus = async (id) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ml-training/models/trained/${id}`);
      if (response.ok) {
        const data = await response.json();
        setResult(data);
        setTraining(false);
        addLog(`Training completed! Accuracy: ${(data.metrics.accuracy * 100).toFixed(1)}%`, 'success');
        fetchTrainedModels();
      }
    } catch (error) {
      // Still training, ignore 404s
    }
  };

  const renderParamInput = (paramName, config) => {
    if (config.type === 'range') {
      return (
        <div key={paramName} className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {config.label}
          </label>
          <input
            type="range"
            min={config.min}
            max={config.max}
            step={config.step}
            value={params[paramName]}
            onChange={(e) => setParams({ ...params, [paramName]: parseFloat(e.target.value) })}
            className="w-full"
            disabled={autoTune}
          />
          <span className="text-xs text-gray-500">{params[paramName]}</span>
        </div>
      );
    } else if (config.type === 'choice') {
      return (
        <div key={paramName} className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {config.label}
          </label>
          <select
            value={params[paramName]}
            onChange={(e) => setParams({ ...params, [paramName]: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
            disabled={autoTune}
          >
            {config.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    } else if (config.type === 'boolean') {
      return (
        <div key={paramName} className="mb-4 flex items-center">
          <input
            type="checkbox"
            checked={params[paramName]}
            onChange={(e) => setParams({ ...params, [paramName]: e.target.checked })}
            className="mr-2"
            disabled={autoTune}
          />
          <label className="text-sm font-medium text-gray-700">
            {config.label}
          </label>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Brain className="w-10 h-10 text-indigo-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">ML Training Platform</h1>
                <p className="text-gray-500">Auto-ML Pipeline Dashboard</p>
              </div>
            </div>
            <div className="flex space-x-2">
              <div className="bg-green-100 text-green-700 px-4 py-2 rounded-lg font-medium">
                {models.length} Models
              </div>
              <div className="bg-blue-100 text-blue-700 px-4 py-2 rounded-lg font-medium">
                {trainedModels.length} Trained
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-lg mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('train')}
              className={`flex-1 px-6 py-4 font-medium ${activeTab === 'train' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500'}`}
            >
              <Play className="w-5 h-5 inline mr-2" />
              Train Model
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 px-6 py-4 font-medium ${activeTab === 'history' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500'}`}
            >
              <Database className="w-5 h-5 inline mr-2" />
              Training History
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {activeTab === 'train' ? (
            <>
              {/* Left Panel - Configuration */}
              <div className="lg:col-span-2 space-y-6">
                {/* Dataset Selection */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center">
                    <Database className="w-6 h-6 mr-2 text-indigo-600" />
                    Dataset Configuration
                  </h2>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      CSV File Path
                    </label>
                    <input
                      type="text"
                      value={selectedCsv}
                      onChange={(e) => setSelectedCsv(e.target.value)}
                      placeholder="/app/your_dataset.csv"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Example: /app/Titanic-Dataset_ml_ready.csv</p>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Target Column
                    </label>
                    <input
                      type="text"
                      value={targetColumn}
                      onChange={(e) => setTargetColumn(e.target.value)}
                      placeholder="e.g., Survived"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* Model Selection */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center">
                    <Brain className="w-6 h-6 mr-2 text-indigo-600" />
                    Model Selection
                  </h2>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {models.map(model => (
                      <button
                        key={model}
                        onClick={() => handleModelSelect(model)}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          selectedModel === model
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 hover:border-indigo-300'
                        }`}
                      >
                        <div className="font-medium capitalize">
                          {model.replace('_', ' ')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hyperparameters */}
                {manifest && (
                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold flex items-center">
                        <Zap className="w-6 h-6 mr-2 text-indigo-600" />
                        Hyperparameters
                      </h2>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoTune}
                          onChange={(e) => setAutoTune(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-sm font-medium">Auto-Tune</span>
                      </label>
                    </div>

                    <div className={autoTune ? 'opacity-50 pointer-events-none' : ''}>
                      {Object.entries(manifest.ui_manifest).map(([key, config]) =>
                        renderParamInput(key, config)
                      )}
                    </div>
                  </div>
                )}

                {/* Train Button */}
                <button
                  onClick={handleTrain}
                  disabled={training || !selectedModel || !selectedCsv || !targetColumn}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {training ? (
                    <>
                      <Clock className="w-6 h-6 animate-spin" />
                      <span>Training in Progress...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-6 h-6" />
                      <span>Start Training</span>
                    </>
                  )}
                </button>
              </div>

              {/* Right Panel - Logs & Results */}
              <div className="space-y-6">
                {/* Results */}
                {result && (
                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <h2 className="text-xl font-bold mb-4 flex items-center text-green-600">
                      <CheckCircle className="w-6 h-6 mr-2" />
                      Training Complete!
                    </h2>
                    
                    <div className="space-y-3">
                      <div className="bg-green-50 p-4 rounded-lg">
                        <div className="text-sm text-gray-600">Accuracy</div>
                        <div className="text-3xl font-bold text-green-600">
                          {(result.metrics.accuracy * 100).toFixed(1)}%
                        </div>
                      </div>

                      {result.metrics.f1_score && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-blue-50 p-3 rounded-lg">
                            <div className="text-xs text-gray-600">F1 Score</div>
                            <div className="text-xl font-bold text-blue-600">
                              {(result.metrics.f1_score * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="bg-purple-50 p-3 rounded-lg">
                            <div className="text-xs text-gray-600">Precision</div>
                            <div className="text-xl font-bold text-purple-600">
                              {(result.metrics.precision * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="pt-3 border-t">
                        <div className="text-sm font-medium mb-2">Top Features:</div>
                        {Object.entries(result.feature_importance)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 5)
                          .map(([feature, importance]) => (
                            <div key={feature} className="flex items-center justify-between mb-2">
                              <span className="text-sm text-gray-700 truncate">{feature}</span>
                              <span className="text-sm font-medium text-indigo-600">
                                {(importance * 100).toFixed(1)}%
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Activity Log */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center">
                    <TrendingUp className="w-6 h-6 mr-2 text-indigo-600" />
                    Activity Log
                  </h2>
                  
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {logs.slice().reverse().map((log, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg text-sm ${
                          log.type === 'error' ? 'bg-red-50 text-red-700' :
                          log.type === 'success' ? 'bg-green-50 text-green-700' :
                          'bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="flex-1">{log.message}</span>
                          <span className="text-xs opacity-60">{log.timestamp}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Training History Tab */
            <div className="lg:col-span-3">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4">Training History</h2>
                
                <div className="space-y-4">
                  {trainedModels.map((model) => (
                    <div key={model.job_id} className="border rounded-lg p-4 hover:border-indigo-300 transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-3">
                          <CheckCircle className="w-5 h-5 text-green-500" />
                          <span className="font-bold capitalize">{model.model_type.replace('_', ' ')}</span>
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded">{model.task_type}</span>
                        </div>
                        <div className="text-sm text-gray-500">{new Date(model.created_at).toLocaleString()}</div>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-4 mt-3">
                        <div className="bg-green-50 p-3 rounded">
                          <div className="text-xs text-gray-600">Accuracy</div>
                          <div className="text-lg font-bold text-green-600">
                            {(model.metrics.accuracy * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="bg-blue-50 p-3 rounded">
                          <div className="text-xs text-gray-600">Train Samples</div>
                          <div className="text-lg font-bold text-blue-600">{model.n_samples_train}</div>
                        </div>
                        <div className="bg-purple-50 p-3 rounded">
                          <div className="text-xs text-gray-600">Test Samples</div>
                          <div className="text-lg font-bold text-purple-600">{model.n_samples_test}</div>
                        </div>
                        <div className="bg-orange-50 p-3 rounded">
                          <div className="text-xs text-gray-600">Features</div>
                          <div className="text-lg font-bold text-orange-600">{model.n_features}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}