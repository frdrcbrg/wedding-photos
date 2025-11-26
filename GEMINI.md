# Project Overview

This is a full-stack web application for sharing wedding photos and videos. It consists of a Node.js backend and a vanilla JavaScript frontend.

**Key Features:**

*   **Upload Page:** Guests can upload photos and videos with an access code.
*   **Download Page:** Guests can browse the gallery, select their favorite photos, and receive a download link via email.
*   **S3 Integration:** Files are uploaded directly to an S3-compatible object storage service.
*   **Database:** A PostgreSQL database stores metadata about the uploaded files.
*   **Email Service:** The application can send download links using either Resend or a traditional SMTP server.
*   **Dockerized:** The application is fully containerized for easy deployment.

**Architecture:**

*   **Backend:**
    *   **Framework:** Express.js
    *   **Database:** PostgreSQL
    *   **Storage:** S3 (via `@aws-sdk/client-s3`)
    *   **Email:** Nodemailer and Resend
    *   **Image Processing:** Sharp (for thumbnails)
    *   **Other:** JWT for download links, Archiver for creating zip files.
*   **Frontend:**
    *   **Language:** Vanilla JavaScript (no frameworks)
    *   **Styling:** CSS3 with Flexbox and Grid
    *   **Pages:**
        *   `index.html`: The upload page.
        *   `download.html`: The photo selection and download page.
        *   `admin.html`: An admin interface for managing photos.

# Building and Running

## Docker (Recommended)

1.  **Create `.env` file:**
    ```bash
    cp .env.example .env
    ```
    Then, edit the `.env` file with your S3, database, and email credentials.

2.  **Run with Docker Compose:**
    ```bash
    docker-compose up -d
    ```

## Local Development (Without Docker)

1.  **Install backend dependencies:**
    ```bash
    cd backend
    npm install
    ```

2.  **Configure environment:**
    Create a `.env` file in the project root, and add your S3, database, and email credentials.

3.  **Start the backend server:**
    ```bash
    cd backend
    npm start
    ```

4.  **Access the application:**
    *   **Upload page:** `http://localhost:3000`
    *   **Download page:** `http://localhost:3000/download.html`

# Development Conventions

*   **Code Style:** The JavaScript code is written in a clean, modern style with modules and async/await. The frontend code is well-structured and separated into `app.js` (for the upload page) and `download.js` (for the download page).
*   **API:** The backend exposes a RESTful API for the frontend to consume. The API endpoints are documented in `README.md`.
*   **Environment Variables:** All configuration is handled through environment variables, following 12-factor app principles.
*   **Deployment:** The project is set up for automatic deployment via GitHub webhooks.
*   **Testing:** There are no automated tests in the project.
