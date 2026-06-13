import asyncio
from ai_agent import analyze_logs

async def main():

    result = await analyze_logs("""
May 23 14:21:12 ubuntu-server sshd[2150]:
Failed password for invalid user admin from 203.0.113.45
""")

    print(result)

asyncio.run(main())