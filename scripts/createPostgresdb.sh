#!/bin/bash

# Script: createPostgresql.sh
# Purpose: Set up PostgreSQL on Mac M1 (install, initialize, and start the database).

# Function to install PostgreSQL
install_postgresql() {
  echo "Checking for Homebrew..."
  if ! command -v brew >/dev/null; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  else
    echo "Homebrew is already installed."
  fi

  echo "Installing PostgreSQL with Homebrew..."
  brew install postgresql
}

# Function to initialize the PostgreSQL database
initialize_postgres() {
  echo "Setting up PostgreSQL directories..."
  sudo mkdir -p /usr/local/var
  sudo chown -R $(whoami) /usr/local/var

  echo "Initializing PostgreSQL database..."
  if ! initdb /usr/local/var/postgres; then
    echo "Failed to initialize database. Exiting."
    exit 1
  fi
}

# Function to start PostgreSQL service
start_postgresql() {
  echo "Starting PostgreSQL service..."
  brew services start postgresql

  echo "PostgreSQL setup complete! Test it with: psql -U $(whoami) -d postgres"
}

# Function to install and configure pgvector
install_pgvector() {
  echo "Checking for pgvector..."
  if ! brew list pgvector &>/dev/null; then
    echo "pgvector not found. Installing pgvector..."
    brew install pgvector
  else
    echo "pgvector is already installed."
  fi

  echo "Linking pgvector to PostgreSQL..."
  brew link --overwrite pgvector

  echo "Restarting PostgreSQL to apply changes..."
  brew services restart postgresql

  echo "Creating pgvector extension in the database..."
  psql -U $(whoami) -d postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
}

# Main script
install_postgresql
initialize_postgres
start_postgresql
install_pgvector