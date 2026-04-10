---
title: Data Processing Guide
slug: data-processing
category: Guides
description: Clean, transform, and engineer features on your datasets before model training.
---

# Data Processing Guide

Raw scraped data is almost never ready for machine learning straight away. Columns may contain currency symbols, text where numbers are expected, missing values, or redundant duplicates. This guide explains every operation available in the **Data Processing** tab and when to use each one.

---

## Why Pre-Processing Matters

Machine learning models require clean, numeric input. Two concrete problems you'll encounter with scraped data:

1. A column like `price` scraped as `"£9.99"` is stored as a string. Most models will either error or silently drop the column.
2. A column like `rating` with 15% missing values will cause training to fail or produce biased results if not handled first.

The operations below address these issues in a structured, repeatable way. Applying them in the **right order** is important — always clean before transforming.

---

## Available Operations

### Cleaning

| Operation | What It Does | When to Use It |
|-----------|-------------|----------------|
| **Drop Missing Rows** | Removes every row that contains at least one null/NaN value | When missing data is not systematic and the dataset is large enough to afford the loss |
| **Fill Missing (Mean)** | Replaces null values in numeric columns with the column's arithmetic mean | When the column is roughly normally distributed and missing data is random |
| **Fill Missing (Median)** | Replaces nulls with the column's median value | When the column is skewed (e.g. price, rating count) — median is more robust than mean |
| **Drop Duplicate Rows** | Removes rows where every column value is identical to another row | Almost always a safe first step — duplicate rows add no information and inflate training counts |

> **Order matters.** Drop duplicates before filling missing values, otherwise you may fill and then drop. Drop or fill missing values before any encoding or scaling.

---

### Text → Numeric Conversion

| Operation | What It Does | When to Use It |
|-----------|-------------|----------------|
| **Label Encode** | Replaces each unique string value with an integer (0, 1, 2, …) | When a column has a natural ordinal relationship (e.g. `low`/`medium`/`high`) or you're using a tree-based model that doesn't care about numeric ordering |
| **One-Hot Encode** | Creates a new binary column for each unique category value | When a column is nominal (no ordering) and will be used with a linear or distance-based model — prevents false ordinal assumptions |
| **Extract Number** | Strips all non-numeric characters from a text column and keeps the first numeric value found | The most common clean-up for scraped data: converts `"£9.99"` → `9.99`, `"4.5 stars"` → `4.5` |

> **Label Encode vs One-Hot Encode:** Label encoding implies order (`apple=0`, `banana=1`, `cherry=2`). Random Forest ignores this; linear regression and SVR do not. Use one-hot for nominal categories unless you're sure ordinal order is meaningful.

---

### Feature Engineering

| Operation | What It Does | When to Use It |
|-----------|-------------|----------------|
| **Normalise (Min-Max)** | Scales each value to the 0–1 range: `(x − min) / (max − min)` | When you want features on the same absolute scale but don't know the distribution shape |
| **Standardise (Z-score)** | Scales to mean=0, std=1: `(x − mean) / std` | **Preferred** for SVR, Ridge, Lasso, and neural networks — these algorithms are sensitive to feature magnitude |
| **Log Transform** | Applies `log1p(x)` (natural log of x+1) to each value | When a column has a very right-skewed distribution (e.g. review counts, page views, prices with outliers) — compresses the tail and helps linear models |
| **Bin Column** | Splits a continuous column into N equal-width discrete buckets and label-encodes the bucket index | When you want to convert a numeric feature into categories (e.g. price ranges) or when a non-linear relationship exists between the feature and the target |

---

## Recommended Processing Order

Follow this sequence to avoid common pitfalls:

1. **Drop Duplicate Rows** — always first.
2. **Extract Number** — convert currency/text columns to float before any numeric operation.
3. **Drop Missing Rows** or **Fill Missing** — choose per column depending on how much data you can afford to lose.
4. **Label Encode** or **One-Hot Encode** — convert remaining categorical columns.
5. **Log Transform** — apply to heavily skewed numeric columns.
6. **Normalise** or **Standardise** — apply last, after the column distribution is as clean as possible.

---

## Saving Processed Data

After applying your operations, click **Save as New Dataset**. You can give the output a custom filename — for example `steam_games_v1_clean`. The file is written to `/app/datasets/processed/` inside the container and immediately appears in the **Datasets** tab under a `processed/` prefix.

> **Never overwrite the original.** Always save to a new filename so you can compare the raw and processed versions in the Dataset Explorer.

---

## Tips & Common Mistakes

- **Check column data types first** — open the Dataset in the Dataset Explorer and look at the column type badges before deciding which operations to apply. A column that looks numeric may be stored as `object` (string) if it contains even one non-numeric value.
- **Log transform before standardising** — if you plan to use both, apply log first. Standardising a skewed column and then logging it would give you a worse distribution than logging first.
- **One-hot encoding expands columns** — if a categorical column has 50 unique values, one-hot encoding adds 50 new columns. This can slow training significantly. For high-cardinality columns, label encoding or feature hashing are better alternatives.
- **Target column leakage** — do not apply operations to the column you intend to predict until you understand the impact. For example, binning your target column and then training on bins produces a classification problem, not regression.
- **Standardise the target column if using SVR** — SVR is sensitive to the scale of both features and the target. If your target spans a large range (e.g. 1 to 1,000,000), standardise it before training and remember to invert the transform when interpreting predictions.
