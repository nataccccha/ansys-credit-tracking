import streamlit as st
import pandas as pd

# --- PAGE CONFIGURATION ---
st.set_page_config(page_title="ANSYS Credit Commander", page_icon="⚡", layout="centered")

# --- TITLE & HEADER ---
st.title("⚡ ANSYS Credit Supply Chain")
st.markdown("### Dynamic 'Human-in-the-Loop' Inventory Manager")
st.divider()

# --- SIDEBAR: CONSTANTS ---
with st.sidebar:
    st.header("⚙️ Configuration")
    lead_time_weeks = st.number_input("Procurement Lead Time (Weeks)", value=3, min_value=1)
    safety_buffer_weeks = st.number_input("Safety Buffer (Weeks)", value=1, min_value=0)
    st.info(f"Trigger Warning: If runway drops below **{lead_time_weeks + safety_buffer_weeks} weeks**, we order.")

# --- MAIN INPUT: CURRENT STATUS ---
col1, col2 = st.columns(2)
with col1:
    current_balance = st.number_input("💰 Current Credit Balance", value=10000, step=100)
with col2:
    base_load = st.number_input("📉 Baseline Usage (Non-Whales)", value=500, help="Average weekly usage of everyone EXCEPT top users.")

st.divider()

# --- THE WHALE WATCH SECTION ---
st.subheader("🐋 The 'Whale Watch' (Top User Forecast)")
st.markdown("Input the top users for this week and their self-reported plans.")

# Initialize data if not present
if 'whales' not in st.session_state:
    st.session_state.whales = [
        {"Name": "Engineer A", "Last Week Usage": 1000, "Plan": "Sustaining"},
        {"Name": "Engineer B", "Last Week Usage": 800, "Plan": "Ramping Up (+50%)"},
    ]

# Helper function to calculate burn based on plan
def get_multiplier(plan):
    if plan == "Ramping Down (-90%)": return 0.1
    if plan == "Sustaining (Same)": return 1.0
    if plan == "Ramping Up (+50%)": return 1.5
    return 1.0

# Editable Table for Users
edited_df = st.data_editor(
    pd.DataFrame(st.session_state.whales),
    column_config={
        "Plan": st.column_config.SelectboxColumn(
            "Forecasted Plan",
            options=[
                "Ramping Down (-90%)",
                "Sustaining (Same)",
                "Ramping Up (+50%)"
            ],
            required=True,
        ),
        "Last Week Usage": st.column_config.NumberColumn(
            "Last Wk Usage",
            min_value=0,
            format="%d credits"
        )
    },
    num_rows="dynamic",
    use_container_width=True
)

# --- CALCULATIONS ---
total_whale_forecast = 0
for index, row in edited_df.iterrows():
    multiplier = get_multiplier(row["Plan"])
    projected = row["Last Week Usage"] * multiplier
    total_whale_forecast += projected

total_weekly_burn = base_load + total_whale_forecast
runway_weeks = current_balance / total_weekly_burn if total_weekly_burn > 0 else 999

# --- DASHBOARD RESULTS ---
st.divider()
st.subheader("📊 Forecast Results")

# Metrics
m1, m2, m3 = st.columns(3)
m1.metric("Projected Weekly Burn", f"{int(total_weekly_burn)} Credits", delta_color="inverse")
m2.metric("Weeks of Runway", f"{runway_weeks:.1f} Weeks")
m3.metric("Reorder Threshold", f"{lead_time_weeks + safety_buffer_weeks} Weeks")

# --- THE DECISION ENGINE ---
st.markdown("### 🚨 Recommendation")

threshold = lead_time_weeks + safety_buffer_weeks

if runway_weeks < threshold:
    st.error(f"CRITICAL ACTION: ORDER NOW. Your runway ({runway_weeks:.1f} wks) is lower than Lead Time + Safety Buffer ({threshold} wks).")
    st.markdown(f"""
    **Draft Email to Reseller:**
    > "Please immediately release a drawdown batch. Our projected burn rate has increased to {int(total_weekly_burn)}/week and we will stock out in {runway_weeks:.1f} weeks."
    """)
elif runway_weeks < (threshold + 1):
    st.warning(f"WATCH OUT: You are close to the edge. Monitor daily. Runway: {runway_weeks:.1f} weeks.")
else:
    st.success(f"SAFE: You have plenty of runway ({runway_weeks:.1f} weeks). No action needed.")

# Visual Progress Bar
progress = min(runway_weeks / (threshold * 2), 1.0)
st.progress(progress, text=f"Fuel Tank Status: {runway_weeks:.1f} Weeks Remaining")