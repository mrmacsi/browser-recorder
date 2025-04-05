#!/bin/bash
PID=$(lsof -ti:7777)
if [ -z "$PID" ]; then
  echo "Port 7777 is free"
else
  echo "Killing process $PID using port 7777..."
  kill -9 $PID
  echo "Port 7777 is now free"
fi 