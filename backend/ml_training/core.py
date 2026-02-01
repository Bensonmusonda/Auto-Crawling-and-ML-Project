"""
Core ML Training Logic - Orchestrates model training and evaluation
"""

import os
import joblib
import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from .registry import ModelRegistry
from .strategies import ModelStrategy


class ModelTrainer:
    """
    Core training engine that orchestrates the entire training pipeline.
    Uses the Strategy Pattern to handle different model types.
    """
    
    def __init__(self, csv_path: str, target_column: str, model_type: str, params: Dict[str, Any]):
        """
        Initialize the trainer.
        
        Args:
            csv_path: Path to the cleaned CSV file
            target_column: Name of the target column
            model_type: Type of model to train (e.g., 'random_forest')
            params: Hyperparameters for the model
        """
        self.csv_path = csv_path
        self.target_column = target_column
        self.model_type = model_type
        self.params = params
        self.registry = ModelRegistry()
        
        # Will be populated during training
        self.model = None
        self.strategy = None
        self.feature_names = []
        self.label_encoder = None
        self.metrics = {}
        self.feature_importance = {}
    
    def load_and_prepare_data(self) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Load CSV and prepare train/test split.
        
        Returns:
            X_train, X_test, y_train, y_test
        """
        # Load the CSV
        df = pd.read_csv(self.csv_path)
        
        if self.target_column not in df.columns:
            raise ValueError(f"Target column '{self.target_column}' not found in dataset")
        
        # Separate features and target
        X = df.drop(columns=[self.target_column])
        y = df[self.target_column]
        
        # Store feature names
        self.feature_names = list(X.columns)
        
        # Handle categorical features - convert to numeric
        for col in X.columns:
            if X[col].dtype == 'object':
                le = LabelEncoder()
                X[col] = le.fit_transform(X[col].astype(str))
        
        # Handle categorical target for classification
        task_type = self.registry.get_task_type(self.model_type)
        if task_type == "classification" and y.dtype == 'object':
            self.label_encoder = LabelEncoder()
            y = self.label_encoder.fit_transform(y)
        
        # Convert to numpy arrays
        X = X.values
        y = y.values
        
        # Perform 80/20 train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y if task_type == "classification" else None
        )
        
        return X_train, X_test, y_train, y_test
    
    def train_model(self) -> Dict[str, Any]:
        """
        Execute the complete training pipeline.
        
        Returns:
            Dictionary containing metrics, feature importance, and model path
        """
        # 1. Load and prepare data
        X_train, X_test, y_train, y_test = self.load_and_prepare_data()
        
        # 2. Get the strategy for this model type
        strategy_class = self.registry.get_strategy(self.model_type)
        self.strategy: ModelStrategy = strategy_class()
        
        # 3. Create the model with given parameters
        self.model = self.strategy.create_model(self.params)
        
        # 4. Train the model
        self.model = self.strategy.train(self.model, X_train, y_train)
        
        # 5. Evaluate the model
        self.metrics = self.strategy.evaluate(self.model, X_test, y_test)
        
        # 6. Extract feature importance
        self.feature_importance = self.strategy.get_feature_importance(self.model, self.feature_names)
        
        # 7. Save the model
        model_path = self._save_model()
        
        # 8. Prepare result payload
        result = {
            "metrics": self.metrics,
            "feature_importance": self.feature_importance,
            "model_path": model_path,
            "hyperparameters": self.params,
            "feature_names": self.feature_names,
            "n_samples_train": len(X_train),
            "n_samples_test": len(X_test),
            "n_features": len(self.feature_names),
            "task_type": self.strategy.task_type
        }
        
        return result
    
    def _save_model(self) -> str:
        """
        Save the trained model to disk using joblib.
        
        Returns:
            Path to the saved model file
        """
        # Create models directory if it doesn't exist
        models_dir = "/app/models"
        os.makedirs(models_dir, exist_ok=True)
        
        # Generate model filename
        import time
        timestamp = int(time.time())
        filename = f"{self.model_type}_{timestamp}.joblib"
        model_path = os.path.join(models_dir, filename)
        
        # Save the model along with metadata
        model_package = {
            "model": self.model,
            "feature_names": self.feature_names,
            "label_encoder": self.label_encoder,
            "model_type": self.model_type,
            "hyperparameters": self.params,
            "task_type": self.strategy.task_type
        }
        
        joblib.dump(model_package, model_path)
        
        return model_path
    
    @staticmethod
    def load_model(model_path: str) -> Dict[str, Any]:
        """
        Load a previously saved model.
        
        Args:
            model_path: Path to the saved model file
            
        Returns:
            Dictionary containing the model and metadata
        """
        return joblib.load(model_path)