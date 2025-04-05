#!/bin/bash
PID=$(lsof -ti:5443)
if [ -z "$PID" ]; then
  echo "Port 5443 is free"
else
  echo "Killing process $PID using port 5443..."
  kill -9 $PID
  echo "Port 5443 is now free"
fi 