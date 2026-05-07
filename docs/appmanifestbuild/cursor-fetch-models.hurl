# Fetch Cursor Cloud Agent models
# Usage:
#   hurl --variable CURSOR_API_KEY="$CURSOR_API_KEY" cursor-fetch-models.hurl

GET https://api.cursor.com/v1/models
Authorization: Bearer {{CURSOR_API_KEY}}
Accept: application/json

HTTP 200
