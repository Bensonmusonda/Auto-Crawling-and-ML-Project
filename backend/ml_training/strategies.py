"""
Model Strategies - Strategy Pattern implementation for different ML models
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression, LinearRegression, Ridge
from sklearn.svm import SVC
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score,
    r2_score, mean_absolute_error, mean_squared_error
)


class ModelStrategy(ABC):
    """Abstract base class for model strategies"""
    
    @abstractmethod
    def create_model(self, params: Dict[str, Any]):
        """Create and return the model instance with given parameters"""
        pass
    
    @abstractmethod
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        """Train the model"""
        pass
    
    @abstractmethod
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        """Evaluate the model and return metrics"""
        pass
    
    @abstractmethod
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        """Extract feature importance from the model"""
        pass
    
    @property
    @abstractmethod
    def task_type(self) -> str:
        """Return 'classification' or 'regression'"""
        pass


class RandomForestStrategy(ModelStrategy):
    """Strategy for Random Forest Classifier"""
    
    def create_model(self, params: Dict[str, Any]):
        return RandomForestClassifier(
            n_estimators=params.get("n_estimators", 100),
            max_depth=params.get("max_depth"),
            min_samples_split=params.get("min_samples_split", 2),
            min_samples_leaf=params.get("min_samples_leaf", 1),
            criterion=params.get("criterion", "gini"),
            bootstrap=params.get("bootstrap", True),
            random_state=42,
            n_jobs=-1
        )
    
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        y_pred = model.predict(X_test)
        
        return {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "f1_score": float(f1_score(y_test, y_pred, average='weighted')),
            "precision": float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average='weighted'))
        }
    
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        importances = model.feature_importances_
        return {
            name: float(importance)
            for name, importance in sorted(
                zip(feature_names, importances),
                key=lambda x: x[1],
                reverse=True
            )
        }
    
    @property
    def task_type(self) -> str:
        return "classification"


class LogisticRegressionStrategy(ModelStrategy):
    """Strategy for Logistic Regression"""
    
    def create_model(self, params: Dict[str, Any]):
        return LogisticRegression(
            C=params.get("C", 1.0),
            penalty=params.get("penalty", "l2"),
            solver=params.get("solver", "lbfgs"),
            max_iter=params.get("max_iter", 1000),
            random_state=42,
            n_jobs=-1
        )
    
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        y_pred = model.predict(X_test)
        
        return {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "f1_score": float(f1_score(y_test, y_pred, average='weighted')),
            "precision": float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average='weighted'))
        }
    
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        # For logistic regression, use coefficient magnitudes
        coef = np.abs(model.coef_[0]) if len(model.coef_.shape) == 2 else np.abs(model.coef_)
        return {
            name: float(importance)
            for name, importance in sorted(
                zip(feature_names, coef),
                key=lambda x: x[1],
                reverse=True
            )
        }
    
    @property
    def task_type(self) -> str:
        return "classification"


class GradientBoostingStrategy(ModelStrategy):
    """Strategy for Gradient Boosting Classifier"""
    
    def create_model(self, params: Dict[str, Any]):
        return GradientBoostingClassifier(
            n_estimators=params.get("n_estimators", 100),
            learning_rate=params.get("learning_rate", 0.1),
            max_depth=params.get("max_depth", 3),
            subsample=params.get("subsample", 1.0),
            random_state=42
        )
    
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        y_pred = model.predict(X_test)
        
        return {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "f1_score": float(f1_score(y_test, y_pred, average='weighted')),
            "precision": float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average='weighted'))
        }
    
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        importances = model.feature_importances_
        return {
            name: float(importance)
            for name, importance in sorted(
                zip(feature_names, importances),
                key=lambda x: x[1],
                reverse=True
            )
        }
    
    @property
    def task_type(self) -> str:
        return "classification"


class SVMStrategy(ModelStrategy):
    """Strategy for Support Vector Machine"""
    
    def create_model(self, params: Dict[str, Any]):
        return SVC(
            C=params.get("C", 1.0),
            kernel=params.get("kernel", "rbf"),
            gamma=params.get("gamma", "scale"),
            random_state=42
        )
    
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        y_pred = model.predict(X_test)
        
        return {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "f1_score": float(f1_score(y_test, y_pred, average='weighted')),
            "precision": float(precision_score(y_test, y_pred, average='weighted', zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, average='weighted'))
        }
    
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        # SVM doesn't have built-in feature importance
        # Return empty dict or could implement permutation importance
        return {name: 0.0 for name in feature_names}
    
    @property
    def task_type(self) -> str:
        return "classification"


class LinearRegressionStrategy(ModelStrategy):
    """Strategy for Linear Regression"""
    
    def create_model(self, params: Dict[str, Any]):
        return LinearRegression(
            fit_intercept=params.get("fit_intercept", True),
            n_jobs=-1
        )
    
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        y_pred = model.predict(X_test)
        
        return {
            "r2_score": float(r2_score(y_test, y_pred)),
            "mae": float(mean_absolute_error(y_test, y_pred)),
            "mse": float(mean_squared_error(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred)))
        }
    
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        coef = np.abs(model.coef_)
        return {
            name: float(importance)
            for name, importance in sorted(
                zip(feature_names, coef),
                key=lambda x: x[1],
                reverse=True
            )
        }
    
    @property
    def task_type(self) -> str:
        return "regression"


class RidgeRegressionStrategy(ModelStrategy):
    """Strategy for Ridge Regression"""
    
    def create_model(self, params: Dict[str, Any]):
        return Ridge(
            alpha=params.get("alpha", 1.0),
            fit_intercept=params.get("fit_intercept", True),
            solver=params.get("solver", "auto"),
            random_state=42
        )
    
    def train(self, model, X_train: np.ndarray, y_train: np.ndarray):
        model.fit(X_train, y_train)
        return model
    
    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> Dict[str, float]:
        y_pred = model.predict(X_test)
        
        return {
            "r2_score": float(r2_score(y_test, y_pred)),
            "mae": float(mean_absolute_error(y_test, y_pred)),
            "mse": float(mean_squared_error(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred)))
        }
    
    def get_feature_importance(self, model, feature_names: list) -> Dict[str, float]:
        coef = np.abs(model.coef_)
        return {
            name: float(importance)
            for name, importance in sorted(
                zip(feature_names, coef),
                key=lambda x: x[1],
                reverse=True
            )
        }
    
    @property
    def task_type(self) -> str:
        return "regression"