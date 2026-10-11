"""Render the native wind-and-wave extension mark to a 256 px PNG."""
from PIL import Image, ImageDraw
from pathlib import Path
import math
S = 4
img = Image.new('RGBA', (256*S, 256*S), (0,0,0,0))
d = ImageDraw.Draw(img)
box = lambda b: tuple(round(x*S) for x in b)
d.rounded_rectangle(box((8,8,248,248)),radius=48*S,fill='#122b43')
d.ellipse(box((51,31,205,185)),fill='#193951')
def line(points, color, width):
    pts=[(round(x*S),round(y*S)) for x,y in points]
    d.line(pts,fill=color,width=width*S,joint='curve')
    for x,y in [points[0],points[-1]]:
        r=width/2
        d.ellipse(box((x-r,y-r,x+r,y+r)),fill=color)
for points in [[(128,108),(128,44)],[(128,108),(72,141)],[(128,108),(184,141)],[(128,123),(128,189)]]:
    line(points,'#edfaff',11)
d.ellipse(box((114,94,142,122)),fill='#122b43')
d.ellipse(box((118,98,138,118)),fill='#5eead4')
for y,amp,color,w in [(199,9,'#5eead4',9),(219,7,'#60a5fa',7)]:
    points=[(42+i*172/400,y-amp*math.sin(i*4*math.pi/400)) for i in range(401)]
    line(points,color,w)
out=Path(__file__).resolve().parents[1]/'icons'/'extension-icon.png'
img.resize((256,256),Image.Resampling.LANCZOS).save(out)
print(out)
