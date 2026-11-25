MINEHELP RELAY (for Render)

The relay lets the owner PC and mining PC connect over the internet from
different networks. Both PCs connect OUT to the relay, so no router port
forwarding is needed. Screen traffic is end-to-end TLS pinned to the mining
PC's certificate, so the relay only forwards encrypted bytes.

Deploy
1. Put this Relay folder in its own GitHub repository (or a branch of one).
   Do not include the Windows apps or the node_modules folder.
2. In Render choose New > Blueprint and select that repository. render.yaml
   creates a free web service named minehelp-relay and generates a random
   MINEHELP_RELAY_KEY.
3. When it is live, open the service's Environment tab and copy
   MINEHELP_RELAY_KEY. Your URL looks like https://minehelp-relay.onrender.com

Connect the apps
1. On the owner PC open Minehelp Owner > Internet relay. Paste the URL and key.
2. Choose Save installer, copy that new installer to the mining PC and run it.
   Tick "Allow Minehelp through Windows Firewall", then Allow access.
3. The mining PC shows "Internet relay connected". The owner app lists it
   under My computers from any network.

Notes
- Free Render services sleep after about 15 minutes without traffic and take
  up to a minute to wake. Minehelp keeps retrying, so the first connection
  after a quiet spell can be slow.
- Screen streaming counts against the service's monthly bandwidth.
- Anyone with the key can use the relay to list approved computers, but they
  cannot read or control them without the mining PC's access key. To rotate,
  change MINEHELP_RELAY_KEY in Render and enter the new key in the owner app.
