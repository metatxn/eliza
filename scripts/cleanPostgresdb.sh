#!/bin/bash

# Script: cleanPostgresdb.sh
# Purpose: Stop PostgreSQL service and clean up PostgreSQL data directories.

# Function to stop PostgreSQL service
stop_postgresql() {
  echo "Stopping PostgreSQL service..."
  if brew services stop postgresql; then
    echo "PostgreSQL service stopped successfully."
  else
    echo "Failed to stop PostgreSQL service. Exiting."
    exit 1
  fi
}

# Function to remove PostgreSQL data directory
clean_postgres_data() {
  echo "Removing PostgreSQL data directory..."
  if [ -d /usr/local/var/postgres ]; then
    rm -rf /usr/local/var/postgres
    echo "PostgreSQL data directory cleaned."
  else
    echo "PostgreSQL data directory does not exist. Nothing to clean."
  fi
}

# Function to uninstall PostgreSQL (optional)
uninstall_postgresql() {
  echo "Uninstalling PostgreSQL..."
  if brew uninstall postgresql; then
    echo "PostgreSQL uninstalled successfully."
  else
    echo "Failed to uninstall PostgreSQL. Exiting."
    exit 1
  fi
}

# Main script
stop_postgresql
clean_postgres_data

# Uncomment the following line if you want to uninstall PostgreSQL as well
# uninstall_postgresql
