# BioSync Project Specification

## Project Goal

BioSync is a mobile-based dietary assistant that combines:

1. CGM glucose data
2. Meal image recognition
3. Postprandial iAUC calculation
4. LLM-generated personalised, non-diagnostic dietary feedback

The core pipeline is:

Meal capture
→ Food recognition
→ Postprandial glucose retrieval
→ iAUC calculation
→ LLM interpretation
→ Mobile display

## Functional Requirements

FR1 Health Data
Retrieve timestamped glucose readings from a supported source,
primarily Android Health Connect for the implementation.

FR2 Meal Logging
Allow the user to capture a meal image and store a meal record.

FR3 Food Recognition
Send the meal image to a Computer Vision service and obtain
structured food information.

FR4 Metabolic Calculation
Calculate postprandial incremental Area Under the Curve (iAUC)
using the trapezoidal rule.

FR5 Dietary Feedback
Combine food information and iAUC and submit them to an LLM
to generate personalised, non-diagnostic dietary feedback.

FR6 Visualisation
Display glucose readings, meal information, iAUC and dietary feedback.

FR7 Offline Cache
Store meal, glucose and analysis data locally using SQLite.

## Non-functional Requirements

- Main meal logging flow: <= 4 primary user actions
- iAUC calculation for <= 500 readings: <= 500 ms
  excluding network/API latency
- Temporary network loss must not remove cached data
- HTTPS for client/backend communication
- API credentials must remain on backend
- iAUC, CV and LLM integrations must remain separate modules

## Selected Technology Stack

Mobile:
- React Native
- TypeScript
- MVVM
- SQLite
- Android Health Connect

Backend:
- Python
- Flask
- AWS Lambda
- API Gateway

External:
- Computer Vision API
- LLM API

## Runtime Workflow

1. User captures a meal image.
2. Mobile app creates a meal record containing timestamp and image URI.
3. Meal record is persisted locally.
4. Image is submitted to backend/CV.
5. Food information is returned and stored locally.
6. System waits for the postprandial monitoring period.
7. Mobile app retrieves relevant glucose readings.
8. Mobile app sends glucose readings and stored food information to backend.
9. Backend calculates iAUC.
10. Backend sends food information + iAUC to LLM.
11. Backend returns completed analysis.
12. Mobile app updates local meal record and displays result.

## Out of Scope

Do NOT implement:

- Direct BLE communication with CGM hardware
- Reverse engineering Sinocare/iCan protocols
- Custom CV model training
- Custom LLM training
- Medical diagnosis
- Medication recommendations
- Insulin dosing
- Production clinical infrastructure

## Development Scope

This is a 15-point university mobile systems project.

Prioritise a small working end-to-end vertical slice rather than
implementing a production-grade commercial application.

Do not add features not justified by this specification.