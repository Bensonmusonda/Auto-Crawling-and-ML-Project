"""
Model Registry - Maps model names to strategies and UI manifests
"""

from typing import Dict, Any, List
from .strategies import (
    RandomForestStrategy,
    LogisticRegressionStrategy,
    GradientBoostingStrategy,
    SVMStrategy,
    LinearRegressionStrategy,
    RidgeRegressionStrategy
)


class ModelRegistry:
    """
    Registry that maps model names to their strategies and UI manifests.
    The UI manifest defines parameter types for frontend rendering.
    """
    
    def __init__(self):
        self._models = {
            # Classification Models
            "random_forest": {
                "strategy": RandomForestStrategy,
                "task_type": "classification",
                "ui_manifest": {
                    "n_estimators": {
                        "type": "range",
                        "min": 10,
                        "max": 500,
                        "step": 10,
                        "default": 100,
                        "label": "Number of Trees"
                    },
                    "max_depth": {
                        "type": "range",
                        "min": 1,
                        "max": 50,
                        "step": 1,
                        "default": 10,
                        "label": "Maximum Depth",
                        "nullable": True
                    },
                    "min_samples_split": {
                        "type": "range",
                        "min": 2,
                        "max": 20,
                        "step": 1,
                        "default": 2,
                        "label": "Min Samples Split"
                    },
                    "min_samples_leaf": {
                        "type": "range",
                        "min": 1,
                        "max": 20,
                        "step": 1,
                        "default": 1,
                        "label": "Min Samples Leaf"
                    },
                    "criterion": {
                        "type": "choice",
                        "options": ["gini", "entropy"],
                        "default": "gini",
                        "label": "Split Criterion"
                    },
                    "bootstrap": {
                        "type": "boolean",
                        "default": True,
                        "label": "Bootstrap Samples"
                    }
                }
            },
            "logistic_regression": {
                "strategy": LogisticRegressionStrategy,
                "task_type": "classification",
                "ui_manifest": {
                    "C": {
                        "type": "range",
                        "min": 0.01,
                        "max": 10.0,
                        "step": 0.01,
                        "default": 1.0,
                        "label": "Regularization Strength (C)"
                    },
                    "penalty": {
                        "type": "choice",
                        "options": ["l2", "l1", "elasticnet", "none"],
                        "default": "l2",
                        "label": "Penalty Type"
                    },
                    "solver": {
                        "type": "choice",
                        "options": ["lbfgs", "liblinear", "newton-cg", "sag", "saga"],
                        "default": "lbfgs",
                        "label": "Solver Algorithm"
                    },
                    "max_iter": {
                        "type": "range",
                        "min": 100,
                        "max": 5000,
                        "step": 100,
                        "default": 1000,
                        "label": "Maximum Iterations"
                    }
                }
            },
            "gradient_boosting": {
                "strategy": GradientBoostingStrategy,
                "task_type": "classification",
                "ui_manifest": {
                    "n_estimators": {
                        "type": "range",
                        "min": 50,
                        "max": 500,
                        "step": 10,
                        "default": 100,
                        "label": "Number of Boosting Stages"
                    },
                    "learning_rate": {
                        "type": "range",
                        "min": 0.01,
                        "max": 1.0,
                        "step": 0.01,
                        "default": 0.1,
                        "label": "Learning Rate"
                    },
                    "max_depth": {
                        "type": "range",
                        "min": 1,
                        "max": 20,
                        "step": 1,
                        "default": 3,
                        "label": "Maximum Depth"
                    },
                    "subsample": {
                        "type": "range",
                        "min": 0.1,
                        "max": 1.0,
                        "step": 0.1,
                        "default": 1.0,
                        "label": "Subsample Ratio"
                    }
                }
            },
            "svm": {
                "strategy": SVMStrategy,
                "task_type": "classification",
                "ui_manifest": {
                    "C": {
                        "type": "range",
                        "min": 0.1,
                        "max": 10.0,
                        "step": 0.1,
                        "default": 1.0,
                        "label": "Regularization Parameter (C)"
                    },
                    "kernel": {
                        "type": "choice",
                        "options": ["linear", "poly", "rbf", "sigmoid"],
                        "default": "rbf",
                        "label": "Kernel Type"
                    },
                    "gamma": {
                        "type": "choice",
                        "options": ["scale", "auto"],
                        "default": "scale",
                        "label": "Gamma"
                    }
                }
            },
            # Regression Models
            "linear_regression": {
                "strategy": LinearRegressionStrategy,
                "task_type": "regression",
                "ui_manifest": {
                    "fit_intercept": {
                        "type": "boolean",
                        "default": True,
                        "label": "Fit Intercept"
                    },
                    "normalize": {
                        "type": "boolean",
                        "default": False,
                        "label": "Normalize Features"
                    }
                }
            },
            "ridge_regression": {
                "strategy": RidgeRegressionStrategy,
                "task_type": "regression",
                "ui_manifest": {
                    "alpha": {
                        "type": "range",
                        "min": 0.01,
                        "max": 10.0,
                        "step": 0.01,
                        "default": 1.0,
                        "label": "Regularization Strength (Alpha)"
                    },
                    "fit_intercept": {
                        "type": "boolean",
                        "default": True,
                        "label": "Fit Intercept"
                    },
                    "solver": {
                        "type": "choice",
                        "options": ["auto", "svd", "cholesky", "lsqr", "saga"],
                        "default": "auto",
                        "label": "Solver Algorithm"
                    }
                }
            }
        }
    
    def get_model_info(self, model_name: str) -> Dict[str, Any]:
        """Get complete model information including strategy and UI manifest"""
        if model_name not in self._models:
            raise ValueError(f"Model '{model_name}' not found in registry")
        return self._models[model_name]
    
    def get_strategy(self, model_name: str):
        """Get the strategy class for a given model"""
        return self.get_model_info(model_name)["strategy"]
    
    def get_ui_manifest(self, model_name: str) -> Dict[str, Any]:
        """Get UI manifest for frontend rendering"""
        return self.get_model_info(model_name)["ui_manifest"]
    
    def get_task_type(self, model_name: str) -> str:
        """Get task type (classification or regression)"""
        return self.get_model_info(model_name)["task_type"]
    
    def list_models(self) -> List[str]:
        """List all available model names"""
        return list(self._models.keys())
    
    def list_models_by_type(self, task_type: str) -> List[str]:
        """List models filtered by task type"""
        return [
            name for name, info in self._models.items()
            if info["task_type"] == task_type
        ]
    
    def suggest_hyperparameters(self, model_name: str, n_samples: int, n_features: int) -> Dict[str, Any]:
        """
        Auto-suggest hyperparameters based on dataset characteristics.
        
        Args:
            model_name: Name of the model
            n_samples: Number of samples in dataset
            n_features: Number of features in dataset
            
        Returns:
            Dictionary of suggested hyperparameters
        """
        manifest = self.get_ui_manifest(model_name)
        suggestions = {}
        
        # Apply heuristics based on dataset size
        if model_name == "random_forest":
            # More trees for larger datasets
            if n_samples > 10000:
                suggestions["n_estimators"] = 200
            elif n_samples > 1000:
                suggestions["n_estimators"] = 100
            else:
                suggestions["n_estimators"] = 50
            
            # Deeper trees for datasets with more features
            if n_features > 20:
                suggestions["max_depth"] = 15
            else:
                suggestions["max_depth"] = 10
            
            suggestions["min_samples_split"] = max(2, n_samples // 1000)
            suggestions["min_samples_leaf"] = max(1, n_samples // 2000)
            suggestions["criterion"] = "gini"
            suggestions["bootstrap"] = True
            
        elif model_name == "logistic_regression":
            # Adjust regularization based on features
            if n_features > n_samples:
                suggestions["C"] = 0.1  # Stronger regularization
            else:
                suggestions["C"] = 1.0
            
            suggestions["penalty"] = "l2"
            suggestions["max_iter"] = 1000 if n_samples < 10000 else 2000
            suggestions["solver"] = "lbfgs"
            
        elif model_name == "gradient_boosting":
            if n_samples > 10000:
                suggestions["n_estimators"] = 150
                suggestions["learning_rate"] = 0.05
            else:
                suggestions["n_estimators"] = 100
                suggestions["learning_rate"] = 0.1
            
            suggestions["max_depth"] = 3
            suggestions["subsample"] = 0.8 if n_samples > 1000 else 1.0
            
        elif model_name == "svm":
            suggestions["C"] = 1.0
            suggestions["kernel"] = "rbf" if n_features < 50 else "linear"
            suggestions["gamma"] = "scale"
            
        elif model_name == "linear_regression":
            suggestions["fit_intercept"] = True
            suggestions["normalize"] = False
            
        elif model_name == "ridge_regression":
            if n_features > n_samples:
                suggestions["alpha"] = 10.0
            else:
                suggestions["alpha"] = 1.0
            
            suggestions["fit_intercept"] = True
            suggestions["solver"] = "auto"
        
        # Fill in defaults for any missing parameters
        for param, config in manifest.items():
            if param not in suggestions:
                suggestions[param] = config["default"]
        
        return suggestions