using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace KLineTrainingCamp.Launcher
{
    internal static class BrandIconGenerator
    {
        private static readonly int[] IconSizes = { 16, 20, 24, 32, 40, 48, 64, 128, 256 };

        [STAThread]
        private static int Main(string[] args)
        {
            if (args == null || args.Length == 0 || string.IsNullOrWhiteSpace(args[0])) return 2;

            string iconPath = Path.GetFullPath(args[0]);
            string iconDirectory = Path.GetDirectoryName(iconPath);
            if (!string.IsNullOrWhiteSpace(iconDirectory)) Directory.CreateDirectory(iconDirectory);

            var images = new List<byte[]>();
            foreach (int size in IconSizes) images.Add(RenderPng(size));
            WriteIcon(iconPath, images);

            if (args.Length > 1 && !string.IsNullOrWhiteSpace(args[1]))
            {
                string previewPath = Path.GetFullPath(args[1]);
                string previewDirectory = Path.GetDirectoryName(previewPath);
                if (!string.IsNullOrWhiteSpace(previewDirectory)) Directory.CreateDirectory(previewDirectory);
                File.WriteAllBytes(previewPath, images[images.Count - 1]);
            }
            return 0;
        }

        private static byte[] RenderPng(int size)
        {
            using (var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.Clear(Color.Transparent);
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.CompositingQuality = CompositingQuality.HighQuality;

                float inset = Math.Max(0.75f, size * 0.035f);
                RectangleF tile = new RectangleF(inset, inset, size - (inset * 2.0f), size - (inset * 2.0f));
                using (GraphicsPath tilePath = RoundedRectangle(tile, size * 0.22f))
                using (var background = new LinearGradientBrush(tile, Color.FromArgb(9, 27, 45), Color.FromArgb(18, 63, 88), 135.0f))
                {
                    graphics.FillPath(background, tilePath);
                }

                using (var glow = new SolidBrush(Color.FromArgb(24, 86, 220, 193)))
                {
                    graphics.FillEllipse(glow, size * 0.43f, size * 0.06f, size * 0.58f, size * 0.58f);
                }

                DrawCandle(graphics, size, 0.27f, 0.48f, 0.76f, 0.57f, 0.69f);
                DrawCandle(graphics, size, 0.48f, 0.36f, 0.66f, 0.44f, 0.57f);
                DrawCandle(graphics, size, 0.69f, 0.22f, 0.51f, 0.29f, 0.43f);

                PointF[] trend =
                {
                    new PointF(size * 0.18f, size * 0.72f),
                    new PointF(size * 0.38f, size * 0.54f),
                    new PointF(size * 0.55f, size * 0.60f),
                    new PointF(size * 0.80f, size * 0.29f),
                };
                float trendWidth = Math.Max(1.4f, size * 0.055f);
                using (var trendPen = new Pen(Color.FromArgb(72, 224, 193), trendWidth))
                {
                    trendPen.StartCap = LineCap.Round;
                    trendPen.EndCap = LineCap.Round;
                    trendPen.LineJoin = LineJoin.Round;
                    graphics.DrawLines(trendPen, trend);
                }

                float accentRadius = Math.Max(1.4f, size * 0.052f);
                using (var accent = new SolidBrush(Color.FromArgb(255, 179, 71)))
                {
                    graphics.FillEllipse(accent, trend[3].X - accentRadius, trend[3].Y - accentRadius, accentRadius * 2.0f, accentRadius * 2.0f);
                }

                using (var stream = new MemoryStream())
                {
                    bitmap.Save(stream, ImageFormat.Png);
                    return stream.ToArray();
                }
            }
        }

        private static void DrawCandle(Graphics graphics, int size, float x, float wickTop, float wickBottom, float bodyTop, float bodyBottom)
        {
            float lineWidth = Math.Max(1.0f, size * 0.027f);
            using (var wick = new Pen(Color.FromArgb(201, 251, 241), lineWidth))
            {
                wick.StartCap = LineCap.Round;
                wick.EndCap = LineCap.Round;
                graphics.DrawLine(wick, size * x, size * wickTop, size * x, size * wickBottom);
            }

            float bodyWidth = Math.Max(2.0f, size * 0.095f);
            RectangleF body = new RectangleF(size * x - (bodyWidth / 2.0f), size * bodyTop, bodyWidth, size * (bodyBottom - bodyTop));
            using (GraphicsPath bodyPath = RoundedRectangle(body, Math.Max(0.8f, size * 0.025f)))
            using (var fill = new SolidBrush(Color.FromArgb(234, 253, 248)))
            {
                graphics.FillPath(fill, bodyPath);
            }
        }

        private static GraphicsPath RoundedRectangle(RectangleF rectangle, float radius)
        {
            float diameter = Math.Min(Math.Min(radius * 2.0f, rectangle.Width), rectangle.Height);
            var path = new GraphicsPath();
            if (diameter <= 0.0f)
            {
                path.AddRectangle(rectangle);
                return path;
            }

            var arc = new RectangleF(rectangle.X, rectangle.Y, diameter, diameter);
            path.AddArc(arc, 180.0f, 90.0f);
            arc.X = rectangle.Right - diameter;
            path.AddArc(arc, 270.0f, 90.0f);
            arc.Y = rectangle.Bottom - diameter;
            path.AddArc(arc, 0.0f, 90.0f);
            arc.X = rectangle.Left;
            path.AddArc(arc, 90.0f, 90.0f);
            path.CloseFigure();
            return path;
        }

        private static void WriteIcon(string path, IList<byte[]> images)
        {
            using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write((ushort)0);
                writer.Write((ushort)1);
                writer.Write((ushort)images.Count);

                int offset = 6 + (16 * images.Count);
                for (int index = 0; index < images.Count; index++)
                {
                    int size = IconSizes[index];
                    byte encodedSize = size >= 256 ? (byte)0 : (byte)size;
                    writer.Write(encodedSize);
                    writer.Write(encodedSize);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write((ushort)1);
                    writer.Write((ushort)32);
                    writer.Write((uint)images[index].Length);
                    writer.Write((uint)offset);
                    offset += images[index].Length;
                }

                foreach (byte[] image in images) writer.Write(image);
            }
        }
    }
}
