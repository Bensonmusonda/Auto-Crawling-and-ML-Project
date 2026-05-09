import pandas as pd
import numpy as np
import os

def analyze_dataset(path):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    
    df = pd.read_csv(path)
    print(f"\n--- Analyzing {os.path.basename(path)} ---")
    print(f"Rows: {len(df)}, Columns: {len(df.columns)}")
    
    # Check for suspected columns
    suspects = ['win_percent', 'Points', 'wins', 'target']
    found_suspects = [c for c in suspects if c in df.columns]
    print(f"Found suspect columns: {found_suspects}")
    
    # Check value ranges for all numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    print("\nNumeric Column Ranges:")
    for col in numeric_cols:
        c_min = df[col].min()
        c_max = df[col].max()
        c_mean = df[col].mean()
        print(f"  {col:20} | min: {c_min:10.4f} | max: {c_max:10.4f} | mean: {c_mean:10.4f}")
        
    # Check correlation with potential targets
    # (Assuming the target might be the last column or one of the suspects)
    potential_targets = [c for c in found_suspects if c in df.columns]
    if not potential_targets and len(numeric_cols) > 0:
        potential_targets = [numeric_cols[-1]]
        
    for target in potential_targets:
        print(f"\nCorrelations with '{target}':")
        corrs = df[numeric_cols].corr()[target].sort_values(ascending=False)
        print(corrs.head(10))

if __name__ == "__main__":
    datasets = [
        "datasets/hockey_dataset.csv",
        "datasets/user_1/hockey_dataset_1.csv"
    ]
    for ds in datasets:
        analyze_dataset(ds)
