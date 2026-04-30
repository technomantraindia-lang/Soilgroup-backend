# Soilgroup Backend

Separate backend folder for enquiry APIs and the admin panel.

## What is included

- Public enquiry API for the website form
- Admin login with a dashboard
- Category management page
- Product management page
- Enquiry management page
- MongoDB storage for categories and products
- Automatic first-run migration from `backend/data/categories.json` and `backend/data/products.json`
- Local JSON storage for enquiries

## Run the backend

```bash
cd backend
node src/server.js
```

Or from the project root:

```bash
npm run backend
```

## Admin panel

- URL: `http://localhost:4000/admin`
- First login requires `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`.
- After login, use `Settings` to save a hashed admin username/password.

Set a strong `JWT_SECRET` in `.env` for production.

## MongoDB setup

- Default connection: `mongodb://127.0.0.1:27017/soilgroup_website`
- Configure with `MONGODB_URI`
- Optional database override: `MONGODB_DATABASE`
- The backend now reads both the project root `.env` and `backend/.env`, with `backend/.env` taking priority

If the MongoDB collections are empty on first start, the backend imports any existing JSON catalog data and falls back to the bundled default catalog only when no existing data is found.

## Admin sections

- `Dashboard`: counts and recent activity
- `Categories`: add and delete categories
- `Products`: add and delete products
- `Enquiries`: review, update status, and delete enquiries
- `Settings`: change admin username and password

## API routes

- `GET /api/health`
- `POST /api/enquiries`
- `GET /api/categories`
- `GET /api/categories/:slug/products`
- `GET /api/products`
- `GET /api/products/:slug`
- `POST /api/admin/login`
- `GET /api/admin/profile`
- `PATCH /api/admin/credentials`
- `GET /api/admin/stats`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `DELETE /api/admin/categories/:id`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `DELETE /api/admin/products/:id`
- `GET /api/admin/enquiries`
- `PATCH /api/admin/enquiries/:id`
- `DELETE /api/admin/enquiries/:id`
