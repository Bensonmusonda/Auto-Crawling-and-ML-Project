---
title: ML Training Guide
slug: ml-training-guide
category: Guides
description: Train, evaluate, and use machine learning models on your scraped datasets.
---

# ML Training Guide

This guide walks through every step of the ML Training tab — from selecting a dataset to interpreting results and running live predictions. It also explains when to use each model and what the evaluation metrics actually mean.

---

## Supported Model Types

| Model | Algorithm Family | Strengths | Weaknesses |
|-------|-----------------|-----------|------------|
| `random_forest` | Ensemble (Bagging) | Robust to noise and outliers, handles mixed feature types well, produces feature importance scores | Slower to train and predict on very large datasets, predictions are not directly interpretable |
| `gradient_boosting` | Ensemble (Boosting) | Highest accuracy on structured/tabular data when tuned correctly | More sensitive to hyperparameters and overfitting; slower to train than random forest |
| `linear_regression` | Linear | Extremely fast, fully interpretable coefficients, good baseline | Assumes a linear relationship — performs poorly when the true relationship is non-linear |
| `ridge` | Regularised Linear | Handles correlated features (multicollinearity) better than plain linear regression | Still assumes linearity; alpha hyperparameter needs tuning |
| `svr` | Support Vector | Effective on small-to-medium datasets with many features; works well after scaling | Does not scale well to large datasets; very sensitive to feature scale — always standardise first |

> **Where to start:** `random_forest` is the default for a reason. It works well out of the box with minimal tuning and tells you which features matter most.

---

## Step 1 — Select a Dataset

On the **ML Training** tab, choose a dataset from the dropdown. Only CSV files available in `/app/datasets/` (and its subdirectories) are listed.

Make sure the dataset has been **processed** (cleaned, numeric-only columns) before training. Raw scraped data with string columns or missing values will cause training to fail or produce poor results. See the [Data Processing Guide](data-processing) first if needed.

---

## Step 2 — Choose a Target Column

The **target column** is the value you want the model to predict — also called the **label** or **dependent variable**.

All other numeric columns in the dataset are automatically used as **features** (independent variables). Non-numeric columns are excluded automatically.

Examples:
- To predict a game's popularity score, select `popularity_score` as the target.
- To predict a product's price, select `price` as the target.
- To predict review count, select `review_count` as the target.

---

## Step 3 — Configure Training Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Model Type** | `random_forest` | The algorithm to train. See the table above for guidance. |
| **Test Size** | `0.2` | Fraction of rows held out for evaluation (not used during training). A value of `0.2` means 80% train / 20% test. |
| **n_estimators** (tree models) | `100` | Number of trees in the ensemble. More trees = more accuracy up to a point, but slower training. |
| **max_depth** (tree models) | None | Maximum depth of each tree. Leave as None to grow trees until all leaves are pure — reduces bias but may overfit. |
| **alpha** (Ridge) | `1.0` | Regularisation strength. Higher values penalise large coefficients more heavily, reducing overfitting. |
| **C** and **epsilon** (SVR) | `1.0`, `0.1` | C controls the penalty for misclassification (lower = more regularisation). Epsilon defines the margin of tolerance. |

---

## Step 4 — Launch Training

Click **Start Training**. The job is queued on the `ml_tasks` Celery queue and handled by the `ml_worker` container. The process is **asynchronous** — you can navigate to other tabs and come back. The job status is streamed via WebSocket.

Training time depends on:
- Dataset size (rows × features)
- Model type (gradient boosting is slower than random forest for the same data)
- `n_estimators` (more trees = longer training)

For a 5,000-row dataset with 15 features, expect 2–15 seconds for most models.

---

## Step 5 — Interpret the Results

Once training completes, the results panel shows four sections:

### Evaluation Metrics

| Metric | What It Means | Good Value |
|--------|---------------|------------|
| **R² Score** | Proportion of variance in the target column explained by the model. 1.0 = perfect, 0.0 = model does no better than predicting the mean, negative = worse than predicting the mean. | > 0.7 is generally considered acceptable for structured data |
| **MAE (Mean Absolute Error)** | Average absolute difference between predicted and actual values, in the same units as the target column. | Depends on the target — compare against the target column's range and standard deviation |
| **RMSE (Root Mean Squared Error)** | Similar to MAE but penalises large errors more heavily (because it squares them first). | Should be close to MAE if there are no large outlier mispredictions |

### Feature Importance

A ranked bar chart showing which input columns contributed most to the model's predictions. Available for `random_forest` and `gradient_boosting`.

Use this to:
- Identify which data you should scrape more carefully.
- Drop low-importance features on the next training run to reduce noise.
- Understand whether the model is using sensible signals.

### Predictions vs. Actuals

A scatter chart plotting the model's predictions against the actual values for the held-out test set. A well-calibrated model produces points along the diagonal (y = x line). Systematic deviations (curved patterns, fan shapes) indicate that a different model or additional feature engineering is needed.

---

## Saving & Loading Models

Trained models are saved to `/app/models/` as `.joblib` files named `<dataset>_<model_type>_<job_id>.joblib`. They persist across container restarts because `/app/models/` is a bind-mounted volume.

### Running Live Predictions

The **Prediction Tester** panel on the ML Training tab lets you run a single prediction against any saved model:

1. Choose the model from the dropdown.
2. Enter values for each feature column.
3. Click **Predict** — the result appears instantly without retraining.

This is useful for sanity-checking the model with known examples before using it in production.

---

## Tips & Common Issues

**R² is negative or very low**

Your features may not have predictive power for the chosen target, or the data needs more cleaning. Try:
1. Log-transforming a heavily skewed target column.
2. Dropping low-quality or near-constant feature columns.
3. Adding more rows via another crawl job.

**SVR performance is poor**

SVR is very sensitive to feature scale. Make sure you've applied **Standardise (Z-score)** in the Data Processing tab to all numeric feature columns — and to the target column — before training with SVR.

**Training job fails immediately**

Common causes:
- The target column contains non-numeric values — extract numbers first.
- All feature columns were dropped (e.g. the dataset is 100% non-numeric) — process the data first.
- The test size is too large relative to the dataset (e.g. `test_size=0.5` on a 20-row dataset leaves only 10 training rows).

**Out of memory during training**

`gradient_boosting` with a high `n_estimators` on a large dataset can use significant memory. Reduce `n_estimators` or switch to `random_forest`, which is more memory-efficient.

**Feature importances look wrong**

If two features are highly correlated (e.g. `price` and `discounted_price`), gradient boosting and random forest will split importance between them arbitrarily. Consider dropping one of the correlated features before training.
