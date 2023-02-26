import {
  CloudArrowUpIcon,
  LockClosedIcon,
  ServerIcon,
} from "@heroicons/react/20/solid";

import Image from "next/image";
import heroImg from "../public/queuedash-hero.png";

const openSourceFeatures = [
  {
    name: "Simple and clean UI.",
    description:
      "Compact list view to keep track of your queue. Detailed job modal to dig deeper.",
    icon: CloudArrowUpIcon,
  },
  {
    name: "Add jobs to queue.",
    description: "Manually add jobs to the queue using our JSON editor.",
    icon: LockClosedIcon,
  },
  {
    name: "Database backups.",
    description:
      "Ac tincidunt sapien vehicula erat auctor pellentesque rhoncus. Et magna sit morbi lobortis.",
    icon: ServerIcon,
  },
];

const proFeatures = [
  {
    name: "Alerts and notifications.",
    description:
      "Setup smart alerts and notifications to keep track of your queue and make sure it's running smoothly.",
    icon: CloudArrowUpIcon,
  },
  {
    name: "View queue trends.",
    description:
      "Track performance metrics and find out where you can improve processing.",
    icon: LockClosedIcon,
  },
  {
    name: "Team features.",
    description:
      "Manage multiple queues and share access with your team. Give them access to specific queues or let them view all of them.",
    icon: ServerIcon,
  },
];

export const Features = () => {
  return (
    <div className="relative isolate  bg-white py-24 sm:py-32">
      <svg
        className="absolute inset-0 -z-10 h-full w-full stroke-gray-200 [mask-image:radial-gradient(100%_100%_at_right,white,transparent)]"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="0787a7c5-978c-4f66-83c7-11c213f99cb7"
            width={200}
            height={200}
            x="50%"
            y={-1}
            patternUnits="userSpaceOnUse"
          >
            <path d="M.5 200V.5H200" fill="none" />
          </pattern>
        </defs>
        <rect
          width="100%"
          height="100%"
          strokeWidth={0}
          fill="url(#0787a7c5-978c-4f66-83c7-11c213f99cb7)"
        />
      </svg>
      <svg
        viewBox="0 0 1108 632"
        aria-hidden="true"
        className="absolute top-10 left-[calc(50%-4rem)] -z-10 w-[69.25rem] max-w-none transform-gpu blur-3xl sm:left-[calc(50%-18rem)] lg:left-48 lg:top-[calc(50%-30rem)] xl:left-[calc(50%-24rem)]"
      >
        <path
          fill="url(#175c433f-44f6-4d59-93f0-c5c51ad5566d)"
          fillOpacity=".2"
          d="M235.233 402.609 57.541 321.573.83 631.05l234.404-228.441 320.018 145.945c-65.036-115.261-134.286-322.756 109.01-230.655C968.382 433.026 1031 651.247 1092.23 459.36c48.98-153.51-34.51-321.107-82.37-385.717L810.952 324.222 648.261.088 235.233 402.609Z"
        />
        <defs>
          <linearGradient
            id="175c433f-44f6-4d59-93f0-c5c51ad5566d"
            x1="1220.59"
            x2="-85.053"
            y1="432.766"
            y2="638.714"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#4F46E5" />
            <stop offset={1} stopColor="#80CAFF" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mx-auto max-w-7xl md:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-y-16 gap-x-8 sm:gap-y-20 lg:grid-cols-2 lg:items-start">
          <div className="px-6 md:px-0 lg:pt-4 lg:pr-4">
            <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-lg">
              <h2 className="text-lg font-semibold leading-8 tracking-tight text-blue-600">
                Open source
              </h2>
              <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Manage your queue with ease
              </p>
              <p className="mt-6 text-lg leading-8 text-gray-600">
                QueueDash makes it easy to monitor and manage your queue. Add
                jobs, view jobs, and more.
              </p>
              <dl className="mt-10 max-w-xl space-y-8 text-base leading-7 text-gray-600 lg:max-w-none">
                {openSourceFeatures.map((feature) => (
                  <div key={feature.name} className="relative pl-9">
                    <dt className="inline font-semibold text-gray-900">
                      <feature.icon
                        className="absolute top-1 left-1 h-5 w-5 text-blue-600"
                        aria-hidden="true"
                      />
                      {feature.name}
                    </dt>{" "}
                    <dd className="inline text-gray-600">
                      {feature.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="sm:px-6 lg:px-0">
            <div className="relative isolate overflow-hidden bg-blue-500 px-6 pt-8 sm:mx-auto sm:max-w-2xl sm:rounded-3xl sm:pt-16 sm:pl-16 sm:pr-0 lg:mx-0 lg:max-w-none">
              <div
                className="absolute -inset-y-px -left-3 -z-10 w-full origin-bottom-left skew-x-[-30deg] bg-blue-100 opacity-20 ring-1 ring-inset ring-white"
                aria-hidden="true"
              />
              <div className="mx-auto max-w-2xl sm:mx-0 sm:max-w-none">
                <div className="w-screen overflow-hidden rounded-tl-xl bg-gray-900 ring-1 ring-white/10">
                  <div className="flex bg-gray-800/40 ring-1 ring-white/5">
                    <div className="-mb-px flex text-sm font-medium leading-6 text-gray-400">
                      <div className="border-b border-r border-b-white/20 border-r-white/10 bg-white/5 py-2 px-4 text-white">
                        NotificationSetting.jsx
                      </div>
                      <div className="border-r border-gray-600/10 py-2 px-4">
                        App.jsx
                      </div>
                    </div>
                  </div>
                  <div className="px-6 pt-6 pb-14">
                    <span
                      dangerouslySetInnerHTML={{
                        __html: `<pre class="text-[0.8125rem] leading-6 text-gray-300"><code>import { <span class="text-[#7dd3fc]">useState</span> } from <span class="text-emerald-300">'react'</span>
  import { <span class="text-[#7dd3fc]">Switch</span> } from <span class="text-emerald-300">'@headlessui/react'</span>

  <span class="text-blue-400">function Example</span>() {
      const [<span class="text-[#7dd3fc]">enabled</span>, <span class="text-[#7dd3fc]">setEnabled</span>] = useState(<span class="text-[#7dd3fc]">true</span>)

      return (
        &lt;<span class="text-blue-400">form</span> action="/<span class="text-emerald-300">notification-settings</span>" method="<span class="text-emerald-300">post</span>"&gt;
          &lt;<span class="text-blue-400">Switch</span> checked={<span class="text-[#7dd3fc]">enabled</span>} onChange={<span class="text-[#7dd3fc]">setEnabled</span>} name="<span class="text-emerald-300">notifications</span>"&gt;
            {<span class="text-gray-500">/* ... */</span>}
          &lt;/<span class="text-blue-400">Switch</span>&gt;
          &lt;<span class="text-blue-400">button</span>&gt;Submit&lt;/<span class="text-blue-400">button</span>&gt;
        &lt;/<span class="text-blue-400">form</span>&gt;
      )
  }</code></pre>`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div
                className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10 sm:rounded-3xl"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-18 mx-auto max-w-7xl sm:mt-24 md:px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-y-16 gap-x-8 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <div className="lg:ml-auto lg:pt-4 lg:pl-4">
            <div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-lg">
              <h2 className="text-lg font-semibold leading-8 tracking-tight text-blue-600">
                QueueDash Pro
              </h2>
              <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Lorem ipsum, dolor sit
              </p>
              <p className="mt-6 text-lg leading-8 text-gray-600">
                Everything in open source, plus more.
              </p>
              <dl className="mt-10 max-w-xl space-y-8 text-base leading-7 text-gray-600 lg:max-w-none">
                {proFeatures.map((feature) => (
                  <div key={feature.name} className="relative pl-9">
                    <dt className="inline font-semibold text-gray-900">
                      <feature.icon
                        className="absolute top-1 left-1 h-5 w-5 text-blue-600"
                        aria-hidden="true"
                      />
                      {feature.name}
                    </dt>{" "}
                    <dd className="inline text-gray-600">
                      {feature.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <div className="flex items-start justify-end lg:order-first">
            <Image
              src={heroImg}
              alt="Product screenshot"
              className="w-[48rem] max-w-none rounded-xl shadow-xl ring-1 ring-gray-400/10 sm:w-[57rem]"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
